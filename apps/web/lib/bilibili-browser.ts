import { chromium, type BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const COOKIE_PATH = path.join(os.tmpdir(), "streamgrab_bilibili_cookies.json");
// cookie 有效期 6 小时（SESSDATA 实际有效期更长，但保守一点）
const COOKIE_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedSession {
  cookies: Array<{ name: string; value: string; domain: string; path: string; secure?: boolean; httpOnly?: boolean; sameSite?: string }>;
  savedAt: number;
}

export function loadBilibiliSession(): CachedSession | null {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return null;
    const raw = fs.readFileSync(COOKIE_PATH, "utf-8");
    const session: CachedSession = JSON.parse(raw);
    if (Date.now() - session.savedAt > COOKIE_TTL_MS) {
      console.log("[bilibili-browser] session 已过期");
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveBilibiliSession(cookies: CachedSession["cookies"]) {
  try {
    const session: CachedSession = { cookies, savedAt: Date.now() };
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(session));
    console.log("[bilibili-browser] session 已保存");
  } catch (e) {
    console.warn("[bilibili-browser] 保存 session 失败:", e);
  }
}

export function clearBilibiliSession() {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH);
  } catch {}
}

/** 检查 session 中是否有有效的 SESSDATA（已登录） */
export function isLoggedIn(): boolean {
  const session = loadBilibiliSession();
  if (!session) return false;
  return session.cookies.some((c) => c.name === "SESSDATA" && c.value.length > 10);
}

/** 生成二维码，返回 qrcode_url 和 qrcode_key */
export async function generateQrcode(): Promise<{ url: string; qrcode_key: string }> {
  const resp = await fetch(
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
    {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.bilibili.com",
      },
    }
  );
  const json = (await resp.json()) as { code: number; data?: { url: string; qrcode_key: string } };
  if (json.code !== 0 || !json.data) {
    throw new Error("生成二维码失败");
  }
  return json.data;
}

/** 轮询二维码扫码状态 */
export async function pollQrcode(qrcode_key: string): Promise<{
  status: "waiting" | "scanned" | "confirmed" | "expired";
  cookies?: CachedSession["cookies"];
}> {
  const resp = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`,
    {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.bilibili.com",
      },
    }
  );
  const json = (await resp.json()) as {
    code: number;
    data?: {
      code: number; // 0=已确认 86038=已失效 86090=已扫待确认 86101=未扫
      url?: string;
      refresh_token?: string;
    };
  };

  const inner = json.data?.code;
  if (inner === 0) {
    // 登录成功，从 Set-Cookie 中提取 cookie（fetch 不直接暴露，需要用 Playwright context）
    return { status: "confirmed" };
  }
  if (inner === 86090) return { status: "scanned" };
  if (inner === 86038) return { status: "expired" };
  return { status: "waiting" };
}

/**
 * 用 Playwright 完成扫码登录，保存 session cookie。
 * 返回 qrcode_url（二维码内容，可用于生成图片）。
 * 调用方需轮询 waitForLogin() 确认完成。
 */
export async function startQrcodeLogin(): Promise<{
  qrcode_url: string;
  qrcode_key: string;
  waitForLogin: () => Promise<boolean>;
}> {
  const { url: qrcode_url, qrcode_key } = await generateQrcode();

  const waitForLogin = async (): Promise<boolean> => {
    // 最多等 3 分钟
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      // 用 Playwright 轮询，这样能拿到登录后的 cookie
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        const context = await browser.newContext({ userAgent: UA });
        const page = await context.newPage();

        // 先访问主页，建立 cookie 上下文
        await page.goto("https://www.bilibili.com", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        // 轮询扫码状态
        const pollResp = await page.evaluate(
          async (key) => {
            const r = await fetch(
              `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${key}`,
              { credentials: "include" }
            );
            return r.json();
          },
          qrcode_key
        );

        const innerCode = (pollResp as { data?: { code?: number } }).data?.code;
        if (innerCode === 0) {
          // 登录成功！获取所有 cookie
          const cookies = await context.cookies("https://www.bilibili.com");
          const hasSESSDATA = cookies.some((c) => c.name === "SESSDATA" && c.value.length > 10);
          if (hasSESSDATA) {
            saveBilibiliSession(cookies);
            await browser.close();
            return true;
          }
        }
        await browser.close();
      } catch {
        await browser.close().catch(() => {});
      }
    }
    return false;
  };

  return { qrcode_url, qrcode_key, waitForLogin };
}

interface BilibiliStream {
  quality: number;
  label: string;
  videoUrl: string;
  audioUrl: string;
  width: number;
  height: number;
  bandwidth: number;
  mimeType: string;
  locked: boolean;
  lockReason?: string;
}

/** 用 stealth 浏览器访问 B站页面，从 window.__playinfo__ 读取播放信息 */
export async function fetchBilibiliStreams(
  bvid: string,
  cid: number,
  proxy?: string
): Promise<BilibiliStream[]> {
  const session = loadBilibiliSession();
  console.log(`[bilibili-browser] 启动 Chromium（stealth）解析 bvid=${bvid} loggedIn=${!!session}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(proxy ? { proxy: { server: proxy } } : {}),
  });

  try {
    const context = await browser.newContext({ userAgent: UA, locale: "zh-CN" });

    if (session) {
      await context.addCookies(session.cookies);
      console.log("[bilibili-browser] 已注入登录 cookie");
    } else {
      console.log("[bilibili-browser] 未登录，画质受限（480P 及以下）");
    }

    // 注入反检测脚本，隐藏无头浏览器特征
    await context.addInitScript(() => {
      // 覆盖 navigator.webdriver
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // 模拟真实的 Chrome 插件
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      // 修复 permissions
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "denied" } as PermissionStatus)
          : originalQuery(parameters);
    });

    const page = await context.newPage();
    await page.goto(`https://www.bilibili.com/video/${bvid}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // 等待播放器 JS 写入 window.__playinfo__
    await page.waitForTimeout(4000);

    const playinfo = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      return w.__playinfo__ ?? null;
    }) as {
      code: number;
      data: {
        accept_quality?: number[];
        dash?: {
          video?: Array<{
            id: number;
            baseUrl: string;
            bandwidth: number;
            width: number;
            height: number;
            mimeType: string;
          }>;
          audio?: Array<{ id: number; baseUrl: string; bandwidth: number; mimeType: string }>;
        };
      };
    } | null;

    if (!playinfo || playinfo.code !== 0 || !playinfo.data) {
      throw new Error(`Bilibili 页面未返回播放信息 code=${playinfo?.code ?? "null"}`);
    }

    const acceptQuality = playinfo.data.accept_quality ?? [];
    const dash = playinfo.data.dash;
    console.log(`[bilibili-browser] __playinfo__ accept_quality=${acceptQuality} dash.video=${dash?.video?.length ?? 0}`);

    const streams: BilibiliStream[] = [];
    const resolvedDash = playinfo.data.dash;

    if (resolvedDash?.video && resolvedDash.audio) {
      const bestAudio = resolvedDash.audio.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      const seenQn = new Set<number>();

      for (const v of resolvedDash.video) {
        if (seenQn.has(v.id)) continue;
        seenQn.add(v.id);
        streams.push({
          quality: v.id,
          label: mapQnLabel(v.id),
          videoUrl: v.baseUrl,
          audioUrl: bestAudio.baseUrl,
          width: v.width,
          height: v.height,
          bandwidth: v.bandwidth,
          mimeType: v.mimeType ?? "video/mp4",
          locked: false,
        });
      }

      // 将 accept_quality 中未解锁的画质也加入（标记 locked）
      for (const qn of acceptQuality) {
        if (seenQn.has(qn)) continue;
        const needVip = qn >= 112;
        streams.push({
          quality: qn,
          label: mapQnLabel(qn),
          videoUrl: "",
          audioUrl: "",
          width: 0,
          height: 0,
          bandwidth: 0,
          mimeType: "video/mp4",
          locked: true,
          lockReason: needVip
            ? "需要大会员，请在设置页面登录 Bilibili 大会员账号"
            : "需要登录，请在设置页面登录 Bilibili",
        });
      }
    }

    return streams;
  } finally {
    await browser.close();
  }
}

function mapQnLabel(qn: number): string {
  const map: Record<number, string> = {
    127: "8K 超高清",
    126: "杜比视界",
    125: "HDR 真彩",
    120: "4K 超清",
    116: "1080P 高帧率",
    112: "1080P 高清+",
    80: "1080P 高清",
    74: "720P 高帧率",
    64: "720P 高清",
    48: "480P 清晰",
    32: "360P 流畅",
    16: "360P 极速",
  };
  return map[qn] ?? `${qn}P`;
}
