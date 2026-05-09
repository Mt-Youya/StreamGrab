import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";
import { proxyRequest } from "./proxy-utils";

export interface TikTokParseOptions extends ParseOptions {
  /** 外部传入的浏览器抓取函数，返回视频详情 JSON 响应体字符串 */
  browserFetch?: (videoId: string, videoUrl: string) => Promise<string>;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "sec-ch-ua": '"Chromium";v="125", "Google Chrome";v="125"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

/**
 * 第一层：用 undici 代理爬取 TikTok 页面 HTML，从 DOM 提取视频数据。
 * 绕过 CF 依赖代理 IP 清洁度，成功则无需启动浏览器。
 */
export async function tiktokHttpFetch(videoId: string, videoUrl: string, proxy: string): Promise<string> {
  const { buffer, status } = await proxyRequest(videoUrl, proxy, {
    headers: BROWSER_HEADERS,
    timeout: 20000,
  });
  if (status >= 400) throw new Error(`TikTok HTTP 请求失败: ${status}`);

  const html = buffer.toString("utf8");
  // 检测是否被 CF 拦截
  if (/robot|captcha|challenge|verify/i.test(html) && !html.includes("itemStruct") && !html.includes("playAddr")) {
    throw new Error("TikTok HTTP 被 Cloudflare 拦截");
  }

  // 从页面提取 __UNIVERSAL_DATA_FOR_REHYDRATION__
  const match = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const scope = parsed["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
      const detail = scope?.["webapp.video-detail"] as Record<string, unknown> | undefined;
      if (detail?.["itemInfo"]) {
        return JSON.stringify({ itemInfo: detail["itemInfo"] });
      }
    } catch {
      /* 继续尝试其他格式 */
    }
    return match[1];
  }

  // 尝试 SIGI_STATE
  const sigiMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
  if (sigiMatch) return sigiMatch[1];

  throw new Error("TikTok HTTP 页面未找到视频数据");
}

function extractVideoId(url: string): string {
  const m = url.match(/\/video\/(\d+)/);
  return m?.[1] ?? "";
}

export const tiktokParser: IVideoParser = {
  platform: "tiktok",

  match(url: string): boolean {
    return /tiktok\.com/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const opts = options as TikTokParseOptions;
    console.log(`[tiktok] 开始解析 url="${url}"`);

    // 短链接先解析最终 URL（保留 videoId 提取）
    let finalUrl = url;
    if (url.includes("vm.tiktok.com") || url.includes("vt.tiktok.com")) {
      try {
        const r = await fetch(url, { method: "HEAD", redirect: "follow" });
        finalUrl = r.url || url;
      } catch {
        finalUrl = url;
      }
    }

    const videoId = extractVideoId(finalUrl);
    if (!videoId) throw new Error("无法从 TikTok URL 提取视频 ID");

    if (!opts.browserFetch) {
      throw new Error(
        "TikTok 解析需要浏览器支持（Cloudflare 防护无法绕过纯 HTTP 请求）。\n" +
          "• Vercel 部署：在 Vercel 控制台添加环境变量 BROWSERLESS_TOKEN（免费获取：https://browserless.io）\n" +
          "• 本地部署：已自动支持，无需额外配置"
      );
    }

    const rawBody = await opts.browserFetch(videoId, finalUrl);
    return parseApiResponse(rawBody, videoId, url);
  },
};

/**
 * 解析 TikTok API 响应，支持多种数据格式：
 * - /api/item/detail/ → { itemInfo: { itemStruct: ... } }
 * - /aweme/v1/web/aweme/detail/ → { aweme_detail: ... }
 * - 页面内嵌 __UNIVERSAL_DATA_FOR_REHYDRATION__（备用）
 */
function parseApiResponse(rawBody: string, videoId: string, rawUrl: string): VideoInfo {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error("TikTok 数据解析失败（JSON 格式错误）");
  }

  // 格式1: /api/item/detail/ → itemInfo.itemStruct
  const itemInfo = data["itemInfo"] as Record<string, unknown> | undefined;
  if (itemInfo?.["itemStruct"]) {
    return buildVideoInfo(itemInfo["itemStruct"] as Record<string, unknown>, videoId, rawUrl);
  }

  // 格式2: /aweme/v1/web/aweme/detail/ → aweme_detail（抖音国际版）
  const awemeDetail = data["aweme_detail"] as Record<string, unknown> | undefined;
  if (awemeDetail) {
    return buildFromAwemeDetail(awemeDetail, videoId, rawUrl);
  }

  // 格式3: __UNIVERSAL_DATA_FOR_REHYDRATION__ 页面内嵌数据
  const scope = data["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
  const detail = scope?.["webapp.video-detail"] as Record<string, unknown> | undefined;
  const item = (detail?.["itemInfo"] as Record<string, unknown> | undefined)?.["itemStruct"];
  if (item) {
    return buildVideoInfo(item as Record<string, unknown>, videoId, rawUrl);
  }

  throw new Error("TikTok 返回数据格式未识别，可能需要更新解析器");
}

type TikTokVideoItem = {
  desc?: string;
  author?: { nickname?: string } | string;
  video?: {
    playAddr?: string;
    downloadAddr?: string;
    cover?: string;
    duration?: number;
    width?: number;
    height?: number;
    bitrate?: number;
    bitrateInfo?: Array<{
      Bitrate?: number;
      PlayAddr?: { UrlList?: string[] };
    }>;
  };
  duration?: number;
};

function buildVideoInfo(item: Record<string, unknown>, videoId: string, rawUrl: string): VideoInfo {
  const v = item as TikTokVideoItem;
  const video = v.video;
  if (!video) throw new Error("TikTok 视频字段缺失");

  const desc = String(v.desc ?? "TikTok 视频");
  const author = typeof v.author === "object" ? (v.author?.nickname ?? "未知作者") : (v.author ?? "未知作者");
  const cover = String(video.cover ?? "");
  const duration = Number(video.duration ?? v.duration ?? 0);
  const streams: VideoStream[] = [];

  // 无水印下载地址（最高优先级）
  if (video.downloadAddr) {
    streams.push({
      quality: "nowm",
      label: "原画（无水印）",
      url: video.downloadAddr,
      mimeType: "video/mp4",
      width: video.width,
      height: video.height,
    });
  }

  // 多码率流
  if (video.bitrateInfo?.length) {
    for (const br of video.bitrateInfo) {
      const streamUrl = br.PlayAddr?.UrlList?.[0];
      if (!streamUrl) continue;
      const h = video.height ?? 0;
      const label = h >= 1080 ? "1080P" : h >= 720 ? "720P" : h >= 480 ? "480P" : "原画";
      streams.push({
        quality: label,
        label,
        url: streamUrl,
        mimeType: "video/mp4",
        width: video.width,
        height: video.height,
        bitrate: br.Bitrate,
      });
    }
  }

  // playAddr 兜底
  if (streams.length === 0 && video.playAddr) {
    streams.push({
      quality: "original",
      label: "原画",
      url: video.playAddr,
      mimeType: "video/mp4",
      width: video.width,
      height: video.height,
      bitrate: video.bitrate,
    });
  }

  if (streams.length === 0) throw new Error("未解析到可用视频流");

  console.log(`[tiktok] 解析成功 title="${desc.slice(0, 30)}" streams=${streams.length}`);

  return {
    id: videoId,
    title: desc,
    cover,
    duration,
    author: String(author),
    platform: "tiktok",
    streams,
    rawUrl,
  };
}

// 抖音国际版（aweme_detail 格式）
function buildFromAwemeDetail(d: Record<string, unknown>, videoId: string, rawUrl: string): VideoInfo {
  const video = d["video"] as Record<string, unknown> | undefined;
  const desc = String(d["desc"] ?? "TikTok 视频");
  const author = (d["author"] as Record<string, unknown> | undefined)?.["nickname"] ?? "未知作者";
  const cover =
    ((video?.["cover"] as Record<string, unknown> | undefined)?.["url_list"] as string[] | undefined)?.[0] ?? "";
  const duration = Math.floor(Number(d["duration"] ?? 0) / 1000);

  const playUrls = (video?.["play_addr"] as Record<string, unknown> | undefined)?.["url_list"] as string[] | undefined;
  if (!playUrls?.length) throw new Error("aweme_detail 未找到播放地址");

  const streams: VideoStream[] = playUrls.slice(0, 2).map((u, i) => ({
    quality: i === 0 ? "nowm" : `original_${i}`,
    label: i === 0 ? "原画（无水印）" : `备用线路 ${i}`,
    url: u,
    mimeType: "video/mp4",
  }));

  console.log(`[tiktok] 解析成功（aweme格式）title="${desc.slice(0, 30)}" streams=${streams.length}`);

  return {
    id: String(d["aweme_id"] ?? videoId),
    title: desc,
    cover,
    duration,
    author: String(author),
    platform: "tiktok",
    streams,
    rawUrl,
  };
}

export function runYtdlp(_args: string[], _proxy?: string): Promise<string> {
  return Promise.reject(new Error("yt-dlp 在 Vercel 环境中不可用"));
}
