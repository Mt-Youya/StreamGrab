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

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const ytdlpPath = options.ytdlpPath ?? "yt-dlp";
    console.log(`[douyin] 开始解析 url="${url}" ytdlpPath=${ytdlpPath}`);

    const args = ["--dump-json", "--no-playlist"];
    if (options.proxy) {
      args.push("--proxy", options.proxy);
    }
    if (options.douyinCookieFile) {
      console.log(`[douyin] 使用 cookie 文件: ${options.douyinCookieFile}`);
      args.push("--cookies", options.douyinCookieFile);
    } else {
      console.warn("[douyin] 未配置 cookie 文件，抖音解析大概率失败（需要 Netscape 格式 cookie 文件）");
    }
    args.push(url);

    let raw: string;
    try {
      raw = await runYtdlp(args, options.proxy);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[douyin] yt-dlp 调用失败:`, msg);
      // 给用户友好的提示
      if (msg.includes("cookies")) {
        throw new Error("抖音解析需要登录 Cookie，请在设置中配置抖音 Cookie（Netscape 格式文件路径）");
      }
      throw new Error(`抖音解析失败: ${msg}`);
    }

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
