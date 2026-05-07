import ytdl from "@distube/ytdl-core";
import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";

export const tiktokParser: IVideoParser = {
  platform: "tiktok",

  match(url: string): boolean {
    return /tiktok\.com/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    console.log(`[tiktok] 开始解析 url="${url}"`);

    const agentOpts = options.proxy
      ? { requestOptions: { proxy: options.proxy } }
      : undefined;

    const info = await ytdl.getInfo(url, agentOpts as ytdl.getInfoOptions);
    const { videoDetails } = info;

    // TikTok 格式：合并视频+音频的流
    const formats = ytdl.filterFormats(info.formats, "videoandaudio")
      .filter((f) => f.hasVideo && f.hasAudio);

    // 也收集仅视频流，某些情况下质量更好
    const videoOnly = ytdl.filterFormats(info.formats, "videoonly")
      .filter((f) => f.hasVideo);

    const allVideo = [...formats, ...videoOnly];

    // 按高度去重，选最高质量
    const byHeight = new Map<number, typeof allVideo[0]>();
    for (const f of allVideo) {
      const h = f.height ?? 0;
      if (!byHeight.has(h) || (f.bitrate ?? 0) > (byHeight.get(h)!.bitrate ?? 0)) {
        byHeight.set(h, f);
      }
    }

    const streams: VideoStream[] = [];
    for (const [h, f] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
      const label = h >= 1080 ? "1080P" : h >= 720 ? "720P" : h >= 480 ? "480P" : h > 0 ? `${h}P` : "原画";
      streams.push({
        quality: label,
        label,
        url: f.url!,
        mimeType: f.mimeType?.split(";")[0] ?? "video/mp4",
        width: f.width ?? undefined,
        height: f.height ?? undefined,
        bitrate: f.bitrate ?? undefined,
        formatId: String(f.itag),
      });
    }

    // 如果没有按高度的流，用 url 字段（TikTok 有时直接给单一 url）
    if (streams.length === 0 && info.formats[0]?.url) {
      streams.push({
        quality: "original",
        label: "原画",
        url: info.formats[0].url,
        mimeType: "video/mp4",
      });
    }

    console.log(`[tiktok] 解析成功 title="${videoDetails.title.slice(0, 30)}" streams=${streams.length}`);

    return {
      id: videoDetails.videoId,
      title: videoDetails.title,
      cover: videoDetails.thumbnails.at(-1)?.url ?? "",
      duration: Number(videoDetails.lengthSeconds),
      author: videoDetails.author.name,
      platform: "tiktok",
      streams,
      rawUrl: url,
    };
  },
};

// 保留旧的 runYtdlp 导出兼容性（douyin.ts 曾 import 它）
export function runYtdlp(_args: string[], _proxy?: string): Promise<string> {
  return Promise.reject(new Error("yt-dlp 在 Vercel 环境中不可用"));
}
