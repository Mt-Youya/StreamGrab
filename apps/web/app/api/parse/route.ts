import { NextRequest, NextResponse } from "next/server";
import { dispatch, findParser } from "@streamgrab/core";
import type { ParseApiResponse, VideoInfo } from "@streamgrab/types";
import { loadBilibiliSession } from "@/lib/bilibili-browser";
import { douyinBrowserFetch } from "@/lib/douyin-browser";

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
      return NextResponse.json<ParseApiResponse>(
        { success: false, error: "缺少视频 URL" },
        { status: 400 }
      );
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

    // B站：优先用请求传来的 cookie，其次读 server session，最后用环境变量
    let resolvedCookie = cookie ?? process.env["BILIBILI_COOKIE"];
    if (!resolvedCookie && /bilibili\.com|BV[a-zA-Z0-9]{10}/.test(trimmedUrl)) {
      const session = loadBilibiliSession();
      if (session) {
        resolvedCookie = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        console.log(`[parse] 使用已登录 B站 session cookie`);
      }
    }

    const opts = {
      cookie: resolvedCookie,
      proxy: proxy ?? process.env["HTTP_PROXY"],
      ytdlpPath: ytdlpPath ?? process.env["YTDLP_PATH"] ?? "yt-dlp",
      // 抖音：注入浏览器抓取函数（Browserless 或本地 Playwright）
      ...(matched.platform === "douyin" ? { browserFetch: douyinBrowserFetch } : {}),
    };

    const videoInfo: VideoInfo = await dispatch(trimmedUrl, opts);

    console.log(`[parse] 解析成功 title="${videoInfo.title}" streams=${videoInfo.streams.length} 耗时=${Date.now() - startAt}ms`);
    return NextResponse.json<ParseApiResponse>({ success: true, data: videoInfo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析失败";
    console.error(`[parse] 解析失败 url="${url}" 耗时=${Date.now() - startAt}ms`, err);
    return NextResponse.json<ParseApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
