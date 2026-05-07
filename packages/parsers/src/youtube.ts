import ytdl from "@distube/ytdl-core";
import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";

const QUALITY_MAP: Record<string, string> = {
  "2160": "4K",
  "1440": "2K",
  "1080": "1080P",
  "720": "720P",
  "480": "480P",
  "360": "360P",
  "240": "240P",
  "144": "144P",
};

function codecPriority(codecs: string): number {
  if (/avc1|h264/i.test(codecs)) return 0;
  if (/hvc|hevc|h265/i.test(codecs)) return 1;
  if (/vp9/i.test(codecs)) return 2;
  if (/av01|av1/i.test(codecs)) return 3;
  return 4;
}

export const youtubeParser: IVideoParser = {
  platform: "youtube",

  match(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    console.log(`[youtube] 开始解析 url="${url}"`);

    const agentOpts = options.proxy
      ? { requestOptions: { headers: {}, proxy: options.proxy } }
      : undefined;

    const info = await ytdl.getInfo(url, agentOpts as ytdl.getInfoOptions);
    const { videoDetails } = info;

    // 视频流（仅视频，按画质+编码优先分组）
    const videoFormats = ytdl.filterFormats(info.formats, "videoonly")
      .filter((f) => f.hasVideo && f.height);

    // 音频流（选最高码率）
    const audioFormats = ytdl.filterFormats(info.formats, "audioonly");
    const bestAudio = audioFormats.sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0))[0];

    // 按画质分组，每组优先选 H.264
    const byHeight = new Map<number, typeof videoFormats[0]>();
    for (const f of videoFormats) {
      const h = f.height ?? 0;
      const existing = byHeight.get(h);
      if (!existing || codecPriority(f.codecs ?? "") < codecPriority(existing.codecs ?? "")) {
        byHeight.set(h, f);
      }
    }

    const streams: VideoStream[] = [];
    for (const [h, f] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
      const quality = QUALITY_MAP[String(h)] ?? `${h}P`;
      const isH264 = /avc1|h264/i.test(f.codecs ?? "");
      const codecName = (f.codecs ?? "").split(".")[0];
      streams.push({
        quality,
        label: isH264 ? quality : `${quality} (${codecName})`,
        url: f.url!,
        mimeType: f.mimeType?.split(";")[0] ?? "video/mp4",
        width: f.width ?? undefined,
        height: f.height ?? undefined,
        bitrate: f.bitrate ?? undefined,
        size: f.contentLength ? Number(f.contentLength) : undefined,
        audioUrl: bestAudio?.url,
        // itag 作为 formatId 传给下载层
        formatId: bestAudio ? `${f.itag}+${bestAudio.itag}` : String(f.itag),
      });
    }

    console.log(`[youtube] 解析成功 title="${videoDetails.title.slice(0, 30)}" streams=${streams.length}`);

    return {
      id: videoDetails.videoId,
      title: videoDetails.title,
      cover: videoDetails.thumbnails.at(-1)?.url ?? "",
      duration: Number(videoDetails.lengthSeconds),
      author: videoDetails.author.name,
      platform: "youtube",
      streams,
      rawUrl: url,
    };
  },
};
