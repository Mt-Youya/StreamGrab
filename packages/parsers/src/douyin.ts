import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";
import { runYtdlp } from "./tiktok";

interface YtdlpFormat {
  format_id: string;
  ext: string;
  width?: number;
  height?: number;
  tbr?: number;
  vcodec?: string;
  acodec?: string;
  url?: string;
  format_note?: string;
}

interface YtdlpOutput {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats?: YtdlpFormat[];
  url?: string;
}

function buildStreams(data: YtdlpOutput): VideoStream[] {
  const formats = data.formats ?? [];
  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.url);

  if (videoFormats.length === 0 && data.url) {
    return [{ quality: "original", label: "原画无水印", url: data.url, mimeType: "video/mp4" }];
  }

  const streams: VideoStream[] = [];
  const seen = new Set<string>();

  for (const f of videoFormats) {
    const h = f.height ?? 0;
    const key = `${h}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = h >= 1080 ? "1080P" : h >= 720 ? "720P" : h >= 480 ? "480P" : h > 0 ? `${h}P` : "原画无水印";
    streams.push({
      quality: label,
      label,
      url: f.url!,
      mimeType: `video/${f.ext ?? "mp4"}`,
      width: f.width,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
    });
  }

  return streams.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

export const douyinParser: IVideoParser = {
  platform: "douyin",

  match(url: string): boolean {
    return /douyin\.com/.test(url) || /v\.douyin\.com/.test(url);
  },

  async parse(url: string, _options: ParseOptions): Promise<VideoInfo> {
    console.log(`[douyin] 开始解析 url="${url}"`);
    // 抖音 API 需要浏览器执行 JS 生成签名（a_bogus），无法在纯 HTTP 环境下解析。
    // 在 Vercel 等无服务器环境中暂不支持，请本地部署后使用。
    throw new Error(
      "抖音解析暂不支持在 Vercel 部署版本中使用（需要本地浏览器环境）。请改用本地部署版本，或直接粘贴抖音视频的直链地址。"
    );
    // 以下代码保留供本地环境参考，生产环境不会执行
    const raw = await (async () => "")(); // 防止 TS 报 unreachable

    console.log(`[douyin] yt-dlp 输出长度: ${raw.length} 字节`);
    const data: YtdlpOutput = JSON.parse(raw);
    console.log(`[douyin] 解析到 id=${data.id} title="${data.title}" formats=${data.formats?.length ?? 0}`);

    return {
      id: data.id ?? url,
      title: data.title ?? "抖音视频",
      cover: data.thumbnail ?? "",
      duration: Math.floor(data.duration ?? 0),
      author: data.uploader ?? "未知作者",
      platform: "douyin",
      streams: buildStreams(data),
      rawUrl: url,
    };
  },
};
