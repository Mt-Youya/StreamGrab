import { request } from "undici";
import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";

const ANDROID_UA = "com.ss.android.ugc.trill/494 (Linux; U; Android 9; en_US; ASUS_Z01QD; Build/PI;tt-ok/3.12.13.1)";

function extractVideoId(url: string): string {
  const m = url.match(/\/video\/(\d+)/);
  return m?.[1] ?? "";
}

/**
 * 用 undici.request 发 GET，禁用自动解压（decompress: false），
 * 然后手动 gunzip/brotli，彻底避免 Node 24 fetch 对 zstd 的乱码问题。
 */
async function httpGet(targetUrl: string, reqHeaders: Record<string, string>): Promise<string> {
  const { statusCode, headers, body } = await request(targetUrl, {
    method: "GET",
    headers: { ...reqHeaders, "Accept-Encoding": "gzip, br" },
    // 关键：禁用 undici 的自动解压，由我们手动处理
    bodyTimeout: 15000,
    headersTimeout: 15000,
  });

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}`);
  }

  const encoding = (headers["content-encoding"] as string) ?? "";
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);

  // 手动解压
  const { gunzip, brotliDecompress } = await import("node:zlib");
  const { promisify } = await import("node:util");

  if (encoding.includes("br")) {
    return (await promisify(brotliDecompress)(raw)).toString("utf8");
  }
  if (encoding.includes("gzip") || raw[0] === 0x1f && raw[1] === 0x8b) {
    return (await promisify(gunzip)(raw)).toString("utf8");
  }
  return raw.toString("utf8");
}

export const tiktokParser: IVideoParser = {
  platform: "tiktok",

  match(url: string): boolean {
    return /tiktok\.com/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    console.log(`[tiktok] 开始解析 url="${url}"`);

    // 短链接先跟踪重定向（用标准 fetch 即可，只取最终 URL）
    let finalUrl = url;
    if (url.includes("vm.tiktok.com") || url.includes("vt.tiktok.com")) {
      const r = await fetch(url, { method: "HEAD", redirect: "follow" });
      finalUrl = r.url || url;
    }

    const videoId = extractVideoId(finalUrl);
    if (!videoId) throw new Error("无法从 TikTok URL 提取视频 ID");

    const apiUrl = `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}&iid=7318518857994389254&device_id=7318517321748022790&channel=googleplay&app_name=musical_ly&version_code=300904&device_platform=android&device_type=ASUS_Z01QD&os_version=9`;

    const raw = await httpGet(apiUrl, {
      "User-Agent": ANDROID_UA,
      "Accept": "application/json",
    });

    let json: {
      aweme_list?: Array<{
        aweme_id?: string;
        desc?: string;
        author?: { nickname?: string };
        video?: {
          play_addr?: { url_list?: string[] };
          download_addr?: { url_list?: string[] };
          cover?: { url_list?: string[] };
          duration?: number;
          width?: number;
          height?: number;
          bit_rate?: Array<{
            bit_rate?: number;
            play_addr?: { url_list?: string[] };
          }>;
        };
      }>;
    };

    try {
      json = JSON.parse(raw);
    } catch {
      const hexPreview = Buffer.from(raw.slice(0, 16), "utf8").toString("hex");
      const preview = raw.slice(0, 80).replace(/[\x00-\x1f\x7f-\xff]/g, "?");
      throw new Error(`TikTok API 返回非 JSON 内容 hex=${hexPreview} text=${preview}`);
    }

    const aweme = json.aweme_list?.find((a) => a.aweme_id === videoId) ?? json.aweme_list?.[0];
    if (!aweme) throw new Error("TikTok API 未返回视频信息");

    const { desc, author, video } = aweme;
    if (!video) throw new Error("视频信息缺失");

    const cover = video.cover?.url_list?.[0] ?? "";
    const duration = Math.floor((video.duration ?? 0) / 1000);
    const streams: VideoStream[] = [];

    // 无水印下载地址（最优先）
    const noWmUrl = video.download_addr?.url_list?.[0];
    if (noWmUrl) {
      streams.push({
        quality: "nowm",
        label: "原画（无水印）",
        url: noWmUrl,
        mimeType: "video/mp4",
        width: video.width,
        height: video.height,
      });
    }

    // 多码率流
    if (video.bit_rate?.length) {
      for (const br of video.bit_rate) {
        const streamUrl = br.play_addr?.url_list?.[0];
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
          bitrate: br.bit_rate,
        });
      }
    }

    // 普通播放地址兜底
    if (streams.length === 0) {
      const playUrl = video.play_addr?.url_list?.[0];
      if (playUrl) {
        streams.push({
          quality: "original",
          label: "原画",
          url: playUrl,
          mimeType: "video/mp4",
          width: video.width,
          height: video.height,
        });
      }
    }

    if (streams.length === 0) throw new Error("未解析到可用视频流");

    console.log(`[tiktok] 解析成功 title="${(desc ?? "").slice(0, 30)}" streams=${streams.length}`);

    return {
      id: videoId,
      title: desc ?? "TikTok 视频",
      cover,
      duration,
      author: author?.nickname ?? "未知作者",
      platform: "tiktok",
      streams,
      rawUrl: url,
    };
  },
};

export function runYtdlp(_args: string[], _proxy?: string): Promise<string> {
  return Promise.reject(new Error("yt-dlp 在 Vercel 环境中不可用"));
}
