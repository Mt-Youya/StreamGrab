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

function codecPriority(mimeType: string): number {
  if (/avc1|h264/i.test(mimeType)) return 0;
  if (/hvc|hevc|h265/i.test(mimeType)) return 1;
  if (/vp9/i.test(mimeType)) return 2;
  if (/av01|av1/i.test(mimeType)) return 3;
  return 4;
}

export const youtubeParser: IVideoParser = {
  platform: "youtube",

  match(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    console.log(`[youtube] 开始解析 url="${url}"`);

    // 动态 import，让 serverExternalPackages 生效（不被 Next.js bundle）
    const { Innertube } = await import("youtubei.js");

    // 创建 Innertube 实例，自动处理 PO Token / visitor_data
    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    });

    const videoId = url.match(
      /(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/
    )?.[1];
    if (!videoId) throw new Error("无法从 URL 提取 YouTube 视频 ID");

    const info = await yt.getInfo(videoId);
    const details = info.basic_info;

    // 获取所有流格式
    const streamingData = info.streaming_data;
    if (!streamingData) throw new Error("无法获取视频流信息，可能需要登录");

    const adaptiveFormats = streamingData.adaptive_formats ?? [];

    // 视频流（仅视频）
    const videoFormats = adaptiveFormats.filter(
      (f) => f.has_video && !f.has_audio && f.url
    );

    // 音频流（选最高码率）
    const audioFormats = adaptiveFormats.filter(
      (f) => !f.has_video && f.has_audio && f.url
    );
    const bestAudio = audioFormats.sort(
      (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)
    )[0];

    // 按画质分组，同画质优先 H.264
    const byHeight = new Map<number, typeof videoFormats[0]>();
    for (const f of videoFormats) {
      const h = f.height ?? 0;
      const existing = byHeight.get(h);
      if (!existing || codecPriority(f.mime_type ?? "") < codecPriority(existing.mime_type ?? "")) {
        byHeight.set(h, f);
      }
    }

    const streams: VideoStream[] = [];
    for (const [h, f] of [...byHeight.entries()].sort((a, b) => b[0] - a[0])) {
      const quality = QUALITY_MAP[String(h)] ?? `${h}P`;
      const mime = f.mime_type ?? "";
      const isH264 = /avc1|h264/i.test(mime);
      const codecName = mime.match(/codecs="([^"]+)"/)?.[1]?.split(".")[0] ?? "";
      const itag = (f as { itag?: number }).itag;
      const audioItag = (bestAudio as { itag?: number } | undefined)?.itag;

      streams.push({
        quality,
        label: isH264 ? quality : `${quality} (${codecName})`,
        url: f.url!,
        mimeType: mime.split(";")[0] ?? "video/mp4",
        width: f.width ?? undefined,
        height: h,
        bitrate: f.bitrate ?? undefined,
        audioUrl: bestAudio?.url,
        formatId: itag !== undefined && audioItag !== undefined
          ? `${itag}+${audioItag}`
          : itag !== undefined ? String(itag) : undefined,
      });
    }

    if (streams.length === 0) {
      throw new Error("未获取到视频流，可能需要配置 YOUTUBE_COOKIE 环境变量");
    }

    console.log(`[youtube] 解析成功 title="${details.title?.slice(0, 30)}" streams=${streams.length}`);

    const thumbnail = details.thumbnail?.[details.thumbnail.length - 1]?.url ?? "";

    return {
      id: videoId,
      title: details.title ?? "YouTube 视频",
      cover: thumbnail,
      duration: details.duration ?? 0,
      author: details.author ?? "未知频道",
      platform: "youtube",
      streams,
      rawUrl: url,
    };
  },
};
