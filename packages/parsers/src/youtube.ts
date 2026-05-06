import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";
import { runYtdlp } from "./tiktok";

interface YtFormat {
  format_id: string;
  ext: string;
  width?: number;
  height?: number;
  tbr?: number;
  vcodec?: string;
  acodec?: string;
  url?: string;
  format_note?: string;
  filesize?: number;
  filesize_approx?: number;
}

interface YtOutput {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  formats?: YtFormat[];
}

const QUALITY_MAP: Record<string, string> = {
  "2160": "4K",
  "1440": "2K",
  "1080": "1080P",
  "720": "720P",
  "480": "480P",
  "360": "360P",
};

function buildStreams(data: YtOutput): VideoStream[] {
  const formats = data.formats ?? [];

  const videoFormats = formats.filter(
    (f) => f.vcodec && f.vcodec !== "none" && f.url && f.height
  );
  const audioFormats = formats.filter(
    (f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none") && f.url
  );

  const bestAudio = audioFormats.reduce<YtFormat | null>((best, cur) => {
    if (!best) return cur;
    return (cur.tbr ?? 0) > (best.tbr ?? 0) ? cur : best;
  }, null);

  // 同一画质按编码优先级排序：H.264(avc1) > H.265(hvc/hevc) > VP9 > AV1
  function codecPriority(vcodec: string): number {
    if (/avc1|h264/i.test(vcodec)) return 0;
    if (/hvc|hevc|h265/i.test(vcodec)) return 1;
    if (/vp9/i.test(vcodec)) return 2;
    if (/av01|av1/i.test(vcodec)) return 3;
    return 4;
  }

  // 按画质分组，每组内选最优编码
  const byHeight = new Map<number, typeof videoFormats[0]>();
  for (const f of videoFormats) {
    const h = f.height ?? 0;
    const existing = byHeight.get(h);
    if (!existing || codecPriority(f.vcodec ?? "") < codecPriority(existing.vcodec ?? "")) {
      byHeight.set(h, f);
    }
  }

  const streams: VideoStream[] = [];

  for (const [, f] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
    const h = String(f.height ?? 0);
    const quality = QUALITY_MAP[h] ?? `${h}P`;
    // formatId 格式：video_id+audio_id，供下载时精确指定
    const formatId = bestAudio
      ? `${f.format_id}+${bestAudio.format_id}`
      : f.format_id;
    const isH264 = /avc1|h264/i.test(f.vcodec ?? "");
    streams.push({
      quality,
      label: isH264 ? quality : `${quality} (${f.vcodec?.split(".")[0] ?? "原始编码"})`,
      url: f.url!,
      mimeType: `video/${f.ext ?? "mp4"}`,
      width: f.width,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      size: f.filesize ?? f.filesize_approx,
      audioUrl: bestAudio?.url,
      formatId,
    });
  }

  return streams;
}

export const youtubeParser: IVideoParser = {
  platform: "youtube",

  match(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const ytdlpPath = options.ytdlpPath ?? "yt-dlp";
    console.log(`[youtube] 开始解析 url="${url}" ytdlpPath=${ytdlpPath} proxy=${options.proxy ?? "none"}`);
    const args: string[] = ["--dump-json", "--no-playlist"];

    if (options.proxy) {
      args.push("--proxy", options.proxy);
    }

    args.push(url);

    let raw: string;
    try {
      raw = await runYtdlp(args, options.proxy);
    } catch (err) {
      console.error(`[youtube] yt-dlp 调用失败:`, err);
      throw new Error(`YouTube 解析失败: ${(err as Error).message}`);
    }

    console.log(`[youtube] yt-dlp 输出长度: ${raw.length} 字节`);
    const data: YtOutput = JSON.parse(raw);
    console.log(`[youtube] 解析到 id=${data.id} title="${data.title}" formats=${data.formats?.length ?? 0}`);

    return {
      id: data.id ?? url,
      title: data.title ?? "YouTube 视频",
      cover: data.thumbnail ?? "",
      duration: Math.floor(data.duration ?? 0),
      author: data.channel ?? data.uploader ?? "未知频道",
      platform: "youtube",
      streams: buildStreams(data),
      rawUrl: url,
    };
  },
};
