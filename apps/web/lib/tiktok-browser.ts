/**
 * TikTok 浏览器抓取实现
 *
 * TikTok 有 Cloudflare JS 挑战（"Please Wait" 白屏），纯 HTTP 无法绕过，
 * 必须用真实浏览器执行 JS 并等待挑战通过后从页面 DOM 读取视频数据。
 *
 * 根据环境自动选择：
 * - 有 BROWSERLESS_TOKEN 环境变量 → Browserless 云端 API（Vercel）
 * - 否则 → 本地 Playwright（持久化 context 单例，第二次起 ~6s）
 */
import type { BrowserContext } from "playwright";

/** TikTok 视频详情 API 的 URL 关键词，用于拦截响应（备用） */
const DETAIL_API_PATTERNS = ["/api/item/detail/", "/aweme/v1/web/aweme/detail/"];

export async function tiktokBrowserFetch(videoId: string, videoUrl: string, proxy?: string): Promise<string> {
  const token = process.env["BROWSERLESS_TOKEN"];
  if (token) {
    return fetchViaBrowserless(videoId, videoUrl, token, proxy);
  }
  return fetchViaLocalPlaywright(videoId, videoUrl, proxy);
}

async function fetchViaBrowserless(_videoId: string, videoUrl: string, token: string, proxy?: string): Promise<string> {
  // Browserless 通过 &proxy= 查询参数传代理（格式: protocol://host:port）
  const proxyParam = proxy ? `&proxy=${encodeURIComponent(proxy)}` : "";
  const endpoint = `https://production-sfo.browserless.io/chromium/function?token=${token}${proxyParam}`;

  const patterns = JSON.stringify(DETAIL_API_PATTERNS);
  const targetUrl = JSON.stringify(videoUrl);

  const code = `
    export default async ({ page }) => {
      const patterns = ${patterns};
      const videoUrl = ${targetUrl};
      let detailBody = null;

      page.on('response', async (resp) => {
        if (detailBody) return;
        const url = resp.url();
        if (!patterns.some(p => url.includes(p))) return;
        try {
          const body = await resp.text();
          if (body.includes('itemStruct') || body.includes('aweme_detail') || body.includes('playAddr')) {
            detailBody = body;
          }
        } catch {}
      });

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      });

      await page.goto(videoUrl, {
        waitUntil: 'networkidle',
        timeout: 35000,
      }).catch(() => {});

      if (detailBody) return { data: detailBody };

      const pageData = await page.evaluate(() => {
        const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        return el ? el.textContent : null;
      });

      if (pageData && (pageData.includes('itemStruct') || pageData.includes('playAddr'))) {
        try {
          const parsed = JSON.parse(pageData);
          const scope = parsed['__DEFAULT_SCOPE__'];
          const detail = scope?.['webapp.video-detail'];
          if (detail?.['itemInfo']) {
            return { data: JSON.stringify({ itemInfo: detail['itemInfo'] }) };
          }
        } catch {}
        return { data: pageData };
      }

      if (!detailBody) throw new Error('TikTok 视频数据获取超时，Cloudflare 挑战可能未通过');
      return { data: detailBody };
    };
  `;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Browserless 请求失败 ${resp.status}: ${text.slice(0, 200)}`);
  }

  const result = (await resp.json()) as { data: string };
  return result.data;
}

// ── 持久化 browser context 单例（按代理分别缓存，复用避免每次重启浏览器）──

// key: proxy url 或 "direct"
const _contextCache = new Map<string, BrowserContext>();
const _contextInitLock = new Map<string, Promise<BrowserContext>>();

async function getSharedContext(proxy?: string): Promise<BrowserContext> {
  const key = proxy ?? "direct";

  // 检查缓存
  const cached = _contextCache.get(key);
  if (cached) {
    try {
      cached.pages();
      return cached;
    } catch {
      _contextCache.delete(key);
    }
  }

  // 正在初始化则等待
  const existing = _contextInitLock.get(key);
  if (existing) return existing;

  const initPromise = (async () => {
    const { chromium } = await import("playwright");

    let browser;
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
      });
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
      });
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      // Playwright 代理配置
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__playwright;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__pw_manual;
    });

    browser.on("disconnected", () => {
      _contextCache.delete(key);
    });
    _contextCache.set(key, context);
    _contextInitLock.delete(key);
    return context;
  })();

  _contextInitLock.set(key, initPromise);
  return initPromise;
}

async function fetchViaLocalPlaywright(_videoId: string, videoUrl: string, proxy?: string): Promise<string> {
  const context = await getSharedContext(proxy);

  let detailBody: string | null = null;
  const page = await context.newPage();

  page.on("response", async (resp) => {
    if (detailBody) return;
    const url = resp.url();
    if (!DETAIL_API_PATTERNS.some((p) => url.includes(p))) return;
    try {
      const body = await resp.text();
      if (body.includes("itemStruct") || body.includes("aweme_detail") || body.includes("playAddr")) {
        detailBody = body;
      }
    } catch {}
  });

  try {
    await page.goto(videoUrl, { waitUntil: "networkidle", timeout: 35000 }).catch(() => {});

    if (detailBody) {
      await page.close();
      return detailBody;
    }

    // CF 挑战通过后可能发生额外跳转，再等一次稳定
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    // 策略2：从 DOM 读取（CF 跳转后 context 可能销毁，重试一次）
    let pageData: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        pageData = await page.evaluate(() => {
          const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
          return el?.textContent ?? null;
        });
        break;
      } catch {
        if (attempt === 0) await page.waitForTimeout(800).catch(() => {});
      }
    }

    await page.close();

    if (pageData && (pageData.includes("itemStruct") || pageData.includes("playAddr"))) {
      try {
        const parsed = JSON.parse(pageData) as Record<string, unknown>;
        const scope = parsed["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
        const detail = scope?.["webapp.video-detail"] as Record<string, unknown> | undefined;
        if (detail?.["itemInfo"]) {
          return JSON.stringify({ itemInfo: detail["itemInfo"] });
        }
      } catch {}
      return pageData;
    }

    throw new Error("TikTok 视频数据获取超时，Cloudflare 挑战可能未通过");
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}
