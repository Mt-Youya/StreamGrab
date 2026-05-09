import { NextRequest, NextResponse } from "next/server";
import { dispatch, findParser } from "@streamgrab/core";
import type { ParseApiResponse, VideoInfo } from "@streamgrab/types";
import { loadBilibiliSessionAsync } from "@/lib/bilibili-browser";
import { douyinBrowserFetch } from "@/lib/douyin-browser";
import { tiktokBrowserFetch } from "@/lib/tiktok-browser";
import { tiktokHttpFetch } from "@streamgrab/parsers";
import { getCached, setCached } from "@/lib/parse-cache";

/** 将底层技术错误消息翻译成用户可读的中文 */
function translateParseError(msg: string): string {
  // B站 API 错误码映射
  if (msg.includes("Bilibili API 错误")) {
    if (msg.includes("-404")) return "视频不存在或已被删除";
    if (msg.includes("-403")) return "没有权限访问该视频，可能需要大会员";
    if (msg.includes("-412")) return "请求过于频繁，请稍后再试";
    if (msg.includes("-101")) return "账号未登录，请在设置页扫码登录";
    if (msg.includes("-111")) return "账号被封禁";
    if (msg.includes("62002")) return "视频已下线";
    if (msg.includes("62004")) return "视频审核中，暂不可访问";
    return "B站解析失败，请检查链接是否有效";
  }
  // Playwright / 浏览器相关
  if (msg.includes("Executable doesn't exist") || msg.includes("playwright install")) {
    return "本地 Chromium 未安装，请在设置页查看安装说明";
  }
  if (msg.includes("browserless")) {
    return "云端浏览器连接失败，请检查 BROWSERLESS_TOKEN 环境变量";
  }
  // 网络超时
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
    return "请求超时，请检查网络或代理设置后重试";
  }
  // 原样返回，但过滤掉技术堆栈信息（冒号后的英文错误）
  return msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
}

export async function POST(req: NextRequest) {
  const startAt = Date.now();
  let url = "<unknown>";
  try {
    const body = (await req.json()) as {
      url?: string;
      cookie?: string;
      proxy?: string;
      ytdlpPath?: string;
    };
    url = body.url ?? "";
    const { cookie, proxy, ytdlpPath } = body;

    console.log(`[parse] 收到请求 url="${url}"`);

    if (!url || typeof url !== "string") {
      return NextResponse.json<ParseApiResponse>({ success: false, error: "缺少视频 URL" }, { status: 400 });
    }

    const trimmedUrl = url.trim();
    const matched = findParser(trimmedUrl);
    if (!matched) {
      return NextResponse.json<ParseApiResponse>(
        { success: false, error: `不支持该平台链接: ${trimmedUrl}` },
        { status: 400 }
      );
    }
    console.log(`[parse] 匹配解析器: platform=${matched.platform}`);

    // ── 缓存层：命中则直接返回 ──
    const cached = await getCached(trimmedUrl, matched.platform);
    if (cached) {
      console.log(`[parse] 缓存命中 title="${cached.title}" 耗时=${Date.now() - startAt}ms`);
      return NextResponse.json<ParseApiResponse>({ success: true, data: cached });
    }

    // B站：优先用请求传来的 cookie，其次读 server session，最后用环境变量
    let resolvedCookie = cookie ?? process.env["BILIBILI_COOKIE"];
    if (!resolvedCookie && /bilibili\.com|BV[a-zA-Z0-9]{10}/.test(trimmedUrl)) {
      const session = await loadBilibiliSessionAsync();
      if (session) {
        resolvedCookie = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        console.log(`[parse] 使用已登录 B站 session cookie`);
      }
    }

    const resolvedProxy = proxy ?? process.env["HTTP_PROXY"] ?? process.env["http_proxy"];
    const baseOpts = {
      cookie: resolvedCookie,
      ytdlpPath: ytdlpPath ?? process.env["YTDLP_PATH"] ?? "yt-dlp",
    };

    let videoInfo: VideoInfo;

    if (matched.platform === "tiktok") {
      // TikTok 三层兜底：① undici HTTP 代理 → ② Playwright/Browserless 代理 → ③ 直连
      videoInfo = await parseTikTok(trimmedUrl, resolvedProxy, baseOpts, startAt);
    } else if (matched.platform === "douyin") {
      // 抖音两层兜底：① Playwright/Browserless 代理 → ② 直连
      videoInfo = await parseDouyin(trimmedUrl, resolvedProxy, baseOpts, startAt);
    } else if (resolvedProxy) {
      try {
        console.log(`[parse] 尝试代理解析 proxy=${resolvedProxy}`);
        videoInfo = await dispatch(trimmedUrl, { ...baseOpts, proxy: resolvedProxy });
        console.log(
          `[parse] 代理解析成功 title="${videoInfo.title}" streams=${videoInfo.streams.length} 耗时=${Date.now() - startAt}ms`
        );
      } catch (proxyErr) {
        console.warn(`[parse] 代理解析失败（${(proxyErr as Error).message}），回退直链重试...`);
        videoInfo = await dispatch(trimmedUrl, { ...baseOpts, proxy: undefined });
        console.log(
          `[parse] 直链解析成功 title="${videoInfo.title}" streams=${videoInfo.streams.length} 耗时=${Date.now() - startAt}ms`
        );
      }
    } else {
      videoInfo = await dispatch(trimmedUrl, baseOpts);
      console.log(
        `[parse] 解析成功 title="${videoInfo.title}" streams=${videoInfo.streams.length} 耗时=${Date.now() - startAt}ms`
      );
    }

    // ── 解析成功后写入缓存 ──
    await setCached(trimmedUrl, matched.platform, videoInfo);

    return NextResponse.json<ParseApiResponse>({ success: true, data: videoInfo });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "解析失败";
    const message = translateParseError(raw);
    console.error(`[parse] 解析失败 url="${url}" 耗时=${Date.now() - startAt}ms`, err);
    return NextResponse.json<ParseApiResponse>({ success: false, error: message }, { status: 500 });
  }
}

// ── TikTok 三层兜底 ──────────────────────────────────────────
async function parseTikTok(
  url: string,
  proxy: string | undefined,
  baseOpts: Record<string, unknown>,
  startAt: number
): Promise<VideoInfo> {
  const videoId = url.match(/\/video\/(\d+)/)?.[1] ?? "";

  // 层①：undici HTTP 代理直接爬 HTML（有代理才尝试，最快）
  if (proxy && videoId) {
    try {
      console.log(`[parse] [tiktok] 层① HTTP代理爬取 proxy=${proxy}`);
      const rawBody = await tiktokHttpFetch(videoId, url, proxy);
      const { dispatch } = await import("@streamgrab/core");
      const info = await dispatch(url, {
        ...baseOpts,
        browserFetch: () => Promise.resolve(rawBody),
      });
      console.log(`[parse] [tiktok] 层① 成功 title="${info.title}" 耗时=${Date.now() - startAt}ms`);
      return info;
    } catch (e) {
      console.warn(`[parse] [tiktok] 层① 失败（${(e as Error).message}），进入层②`);
    }
  }

  // 层②：Playwright/Browserless 走代理（有代理时）
  if (proxy) {
    try {
      console.log(`[parse] [tiktok] 层② 浏览器代理 proxy=${proxy}`);
      const { dispatch } = await import("@streamgrab/core");
      const info = await dispatch(url, {
        ...baseOpts,
        browserFetch: (vid: string, vurl: string) => tiktokBrowserFetch(vid, vurl, proxy),
      });
      console.log(`[parse] [tiktok] 层② 成功 title="${info.title}" 耗时=${Date.now() - startAt}ms`);
      return info;
    } catch (e) {
      console.warn(`[parse] [tiktok] 层② 失败（${(e as Error).message}），进入层③`);
    }
  }

  // 层③：Playwright/Browserless 直连（无代理兜底）
  console.log(`[parse] [tiktok] 层③ 浏览器直连`);
  const { dispatch } = await import("@streamgrab/core");
  const info = await dispatch(url, {
    ...baseOpts,
    browserFetch: (vid: string, vurl: string) => tiktokBrowserFetch(vid, vurl),
  });
  console.log(`[parse] [tiktok] 层③ 成功 title="${info.title}" 耗时=${Date.now() - startAt}ms`);
  return info;
}

// ── 抖音两层兜底 ─────────────────────────────────────────────
async function parseDouyin(
  url: string,
  proxy: string | undefined,
  baseOpts: Record<string, unknown>,
  startAt: number
): Promise<VideoInfo> {
  // 层①：Playwright/Browserless 走代理（有代理时）
  if (proxy) {
    try {
      console.log(`[parse] [douyin] 层① 浏览器代理 proxy=${proxy}`);
      const { dispatch } = await import("@streamgrab/core");
      const info = await dispatch(url, {
        ...baseOpts,
        browserFetch: (vid: string) => douyinBrowserFetch(vid, proxy),
      });
      console.log(`[parse] [douyin] 层① 成功 title="${info.title}" 耗时=${Date.now() - startAt}ms`);
      return info;
    } catch (e) {
      console.warn(`[parse] [douyin] 层① 失败（${(e as Error).message}），进入层②`);
    }
  }

  // 层②：直连
  console.log(`[parse] [douyin] 层② 浏览器直连`);
  const { dispatch } = await import("@streamgrab/core");
  const info = await dispatch(url, {
    ...baseOpts,
    browserFetch: (vid: string) => douyinBrowserFetch(vid),
  });
  console.log(`[parse] [douyin] 层② 成功 title="${info.title}" 耗时=${Date.now() - startAt}ms`);
  return info;
}
