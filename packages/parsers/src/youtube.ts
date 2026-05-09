import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";
// 用 undici（youtubei.js 内部依赖的版本）构建代理 fetch，确保兼容
import { fetch as undiciFetch, ProxyAgent } from "undici";

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
    const proxy = (options as Record<string, unknown>).proxy as string | undefined;
    console.log(`[youtube] 开始解析 url="${url}" proxy=${proxy ?? "无"}`);

    // 动态 import，让 serverExternalPackages 生效（不被 Next.js bundle）
    const { Innertube } = await import("youtubei.js");

    const videoId = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error("无法从 URL 提取 YouTube 视频 ID");

    // 依次尝试多个 client，直到拿到 streaming_data
    // TV_EMBEDDED / IOS 不需要 PO Token，规避 Vercel IP bot 检测
    const CLIENTS = ["TV_EMBEDDED", "IOS", "ANDROID", "WEB"] as const;
    type YTClient = (typeof CLIENTS)[number];

    /** 创建 Innertube（注入 fetch）并遍历 CLIENTS 尝试获取 streaming_data */
    async function tryInnertube(fetchFn?: typeof fetch) {
      const ytInstance = await Innertube.create({
        retrieve_player: true,
        generate_session_locally: true,
        fetch: fetchFn,
      });
      let result: Awaited<ReturnType<typeof ytInstance.getInfo>> | null = null;
      let lastErr: Error | null = null;
      for (const client of CLIENTS) {
        try {
          const candidate = await ytInstance.getInfo(videoId!, { client: client as YTClient });
          if (candidate.streaming_data) {
            result = candidate;
            console.log(`[youtube] client=${client} 获取流成功`);
            break;
          }
          console.log(`[youtube] client=${client} streaming_data 为空，尝试下一个`);
        } catch (e) {
          lastErr = e as Error;
          console.log(`[youtube] client=${client} 失败: ${(e as Error).message}`);
        }
      }
      if (!result) throw lastErr ?? new Error("无法获取视频流信息，所有 client 均失败");
      return result;
    }

    // 代理优先，直链兜底
    // 将 undici ProxyAgent 包装成 fetch 函数注入 Innertube
    let info: Awaited<ReturnType<typeof tryInnertube>>;
    if (proxy) {
      const proxyAgent = new ProxyAgent({
        uri: proxy,
        requestTls: { rejectUnauthorized: false },
        proxyTls: { rejectUnauthorized: false },
      });
      // undici@5 不接受 Request 对象，需要解包成 URL 字符串 + init
      const proxyFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        let url: string;
        let mergedInit: Record<string, unknown> = { ...((init as object) ?? {}) };
        if (typeof input === "string") {
          url = input;
        } else if (input instanceof URL) {
          url = input.href;
        } else {
          // Request 对象 —— 解包
          const req = input as Request;
          url = req.url;
          mergedInit = {
            method: req.method,
            headers: Object.fromEntries((req.headers as Headers).entries()),
            body: (req as Request & { body?: unknown }).body ?? undefined,
            ...mergedInit,
          };
        }
        return undiciFetch(
          url as Parameters<typeof undiciFetch>[0],
          {
            ...mergedInit,
            dispatcher: proxyAgent,
          } as Parameters<typeof undiciFetch>[1]
        );
      }) as unknown as typeof fetch;

      try {
        console.log(`[youtube] 尝试代理解析 proxy=${proxy}`);
        info = await tryInnertube(proxyFetch);
        console.log(`[youtube] 代理解析成功`);
      } catch (proxyErr) {
        const e = proxyErr as Error & { cause?: Error };
        console.warn(
          `[youtube] 代理解析失败（${e.message}${e.cause ? " / " + e.cause.message : ""}），回退直链重试...`
        );
        info = await tryInnertube();
        console.log(`[youtube] 直链解析成功`);
      }
      // 延迟关闭 agent，避免 Innertube 内部异步请求还未完成时被取消
      setTimeout(() => proxyAgent.close().catch(() => {}), 5000);
    } else {
      info = await tryInnertube();
    }

    const details = info.basic_info;

    // 获取所有流格式
    const streamingData = info.streaming_data!;

    const adaptiveFormats = streamingData.adaptive_formats ?? [];

    // 视频流（仅视频）
    const videoFormats = adaptiveFormats.filter((f) => f.has_video && !f.has_audio && f.url);

    // 音频流（选最高码率）
    const audioFormats = adaptiveFormats.filter((f) => !f.has_video && f.has_audio && f.url);
    const bestAudio = audioFormats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

    // 按画质分组，同画质优先 H.264
    const byHeight = new Map<number, (typeof videoFormats)[0]>();
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
        formatId:
          itag !== undefined && audioItag !== undefined
            ? `${itag}+${audioItag}`
            : itag !== undefined
              ? String(itag)
              : undefined,
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
