import { NextRequest, NextResponse } from "next/server";
import { dispatch, findParser } from "@streamgrab/core";
import type { ParseApiResponse, VideoInfo } from "@streamgrab/types";
import { fetchDouyinVideoInfo } from "@/lib/douyin-browser";
import { fetchBilibiliStreams } from "@/lib/bilibili-browser";

export async function POST(req: NextRequest) {
  const startAt = Date.now();
  let url = "<unknown>";
  try {
    const body = (await req.json()) as {
      url?: string;
      cookie?: string;
      douyinCookieFile?: string;
      proxy?: string;
      ytdlpPath?: string;
    };
    url = body.url ?? "";
    const { cookie, douyinCookieFile, proxy, ytdlpPath } = body;

    console.log(`[parse] 收到请求 url="${url}"`);

    if (!url || typeof url !== "string") {
      console.warn("[parse] 请求缺少 url 字段");
      return NextResponse.json<ParseApiResponse>(
        { success: false, error: "缺少视频 URL" },
        { status: 400 }
      );
    }

    const trimmedUrl = url.trim();
    const matched = findParser(trimmedUrl);
    if (!matched) {
      console.warn(`[parse] 没有匹配的解析器，url="${trimmedUrl}"`);
      return NextResponse.json<ParseApiResponse>(
        { success: false, error: `不支持该平台链接: ${trimmedUrl}` },
        { status: 400 }
      );
    }
    console.log(`[parse] 匹配解析器: platform=${matched.platform}`);

    const resolvedProxy = proxy ?? process.env["HTTP_PROXY"];
    const opts = {
      cookie: cookie ?? process.env["BILIBILI_COOKIE"],
      douyinCookieFile: douyinCookieFile,
      proxy: resolvedProxy,
      ytdlpPath: ytdlpPath ?? process.env["YTDLP_PATH"] ?? "yt-dlp",
    };
    console.log(`[parse] 解析选项: hasCookie=${!!opts.cookie} douyinCookieFile=${opts.douyinCookieFile ?? "none"} proxy=${opts.proxy ?? "none"} ytdlpPath=${opts.ytdlpPath}`);

    let videoInfo: VideoInfo;

    // 抖音：用 Playwright 无头浏览器拦截 API 响应（自动处理所有签名）
    if (matched.platform === "douyin") {
      console.log("[parse] 抖音：使用 Playwright 浏览器方案");
      const videoIdMatch = trimmedUrl.match(/video\/(\d+)/);
      if (!videoIdMatch) throw new Error("无法从抖音 URL 提取视频 ID");
      const videoId = videoIdMatch[1];
      const dyInfo = await fetchDouyinVideoInfo(videoId, resolvedProxy);
      videoInfo = {
        id: dyInfo.id,
        title: dyInfo.title,
        cover: dyInfo.cover,
        duration: dyInfo.duration,
        author: dyInfo.author,
        platform: "douyin",
        streams: dyInfo.playUrls.slice(0, 3).map((u, i) => ({
          quality: i === 0 ? "original" : `original_${i}`,
          label: i === 0 ? "原画无水印" : `备用线路 ${i}`,
          url: u,
          mimeType: "video/mp4",
          width: dyInfo.width,
          height: dyInfo.height,
        })),
        rawUrl: trimmedUrl,
      };
    } else if (matched.platform === "bilibili") {
      // Bilibili：先用 API 拿基础信息，再用 Playwright 拦截高清 playurl
      console.log("[parse] Bilibili：使用 Playwright 浏览器方案");
      const bvMatch = trimmedUrl.match(/BV[a-zA-Z0-9]{10}/);
      if (!bvMatch) throw new Error("无法从 URL 提取 BV 号");
      const bvid = bvMatch[0];

      // 获取基础信息（title、cover、cid）
      const viewResp = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://www.bilibili.com",
          },
        }
      );
      const viewJson = (await viewResp.json()) as {
        code?: number;
        data?: {
          cid?: number;
          title?: string;
          pic?: string;
          duration?: number;
          owner?: { name?: string };
          bvid?: string;
        };
      };
      if (viewJson.code !== 0 || !viewJson.data) {
        throw new Error(`Bilibili 视频信息获取失败: ${viewJson.code}`);
      }
      const { cid, title, pic, duration, owner } = viewJson.data;
      if (!cid) throw new Error("无法获取视频 cid");

      // 用 Playwright 拦截 playurl（含登录 cookie 则有高清）
      const biliStreams = await fetchBilibiliStreams(bvid, cid, resolvedProxy);

      videoInfo = {
        id: bvid,
        title: title ?? "未知标题",
        cover: pic ?? "",
        duration: Math.floor(duration ?? 0),
        author: owner?.name ?? "未知UP主",
        platform: "bilibili",
        streams: biliStreams.map((s) => ({
          quality: String(s.quality),
          label: s.label,
          url: s.videoUrl,
          audioUrl: s.audioUrl || undefined,
          mimeType: s.mimeType,
          width: s.width || undefined,
          height: s.height || undefined,
          bitrate: s.bandwidth || undefined,
          locked: s.locked,
          lockReason: s.lockReason,
        })),
        rawUrl: trimmedUrl,
      };
    } else {
      videoInfo = await dispatch(trimmedUrl, opts);
    }

    console.log(`[parse] 解析成功 title="${videoInfo.title}" streams=${videoInfo.streams.length} 耗时=${Date.now() - startAt}ms`);
    return NextResponse.json<ParseApiResponse>({ success: true, data: videoInfo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析失败";
    console.error(`[parse] 解析失败 url="${url}" 耗时=${Date.now() - startAt}ms`);
    console.error("[parse] 错误详情:", err);
    return NextResponse.json<ParseApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
