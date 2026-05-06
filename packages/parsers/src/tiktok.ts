import { spawn } from "node:child_process";
import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";

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
  cookies?: string;
  http_headers?: Record<string, string>;
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

function runYtdlp(args: string[], proxy?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (proxy) env["HTTP_PROXY"] = proxy;

    const cmdStr = `yt-dlp ${args.join(" ")}`;
    console.log(`[yt-dlp] 执行命令: ${cmdStr}`);

    const proc = spawn("yt-dlp", args, { env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      console.log(`[yt-dlp] 进程退出码: ${code}`);
      if (code !== 0) {
        console.error(`[yt-dlp] stderr:\n${stderr.slice(0, 1000)}`);
      }
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp 退出码 ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", (err) => {
      console.error(`[yt-dlp] 启动失败 (是否已安装 yt-dlp?):`, err.message);
      reject(err);
    });
  });
}

function buildStreams(data: YtdlpOutput): VideoStream[] {
  const formats = data.formats ?? [];

  // Prefer formats tagged as "without_watermark" or combined video+audio
  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.url);

  if (videoFormats.length === 0 && data.url) {
    return [{ quality: "original", label: "原画", url: data.url, mimeType: "video/mp4" }];
  }

  const streams: VideoStream[] = [];
  const seen = new Set<string>();

  for (const f of videoFormats) {
    const h = f.height ?? 0;
    const key = `${h}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = h >= 1080 ? "1080P" : h >= 720 ? "720P" : h >= 480 ? "480P" : h > 0 ? `${h}P` : "原画";
    streams.push({
      quality: label,
      label,
      url: f.url!,
      mimeType: `video/${f.ext ?? "mp4"}`,
      width: f.width,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      formatId: f.format_id,
    });
  }

  return streams.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

export const tiktokParser: IVideoParser = {
  platform: "tiktok",

  match(url: string): boolean {
    return /tiktok\.com/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const ytdlpPath = options.ytdlpPath ?? "yt-dlp";
    console.log(`[tiktok] 开始解析 url="${url}" ytdlpPath=${ytdlpPath}`);
    const args = ["--dump-json", "--no-playlist", url];

    let raw: string;
    try {
      raw = await runYtdlp([...args], options.proxy);
    } catch (err) {
      console.error(`[tiktok] yt-dlp 调用失败:`, err);
      throw new Error(`TikTok 解析失败: ${(err as Error).message}`);
    }

    console.log(`[tiktok] yt-dlp 输出长度: ${raw.length} 字节`);
    const data: YtdlpOutput = JSON.parse(raw);
    console.log(`[tiktok] 解析到 id=${data.id} title="${data.title}" formats=${data.formats?.length ?? 0}`);

    return {
      id: data.id ?? url,
      title: data.title ?? "TikTok 视频",
      cover: data.thumbnail ?? "",
      duration: Math.floor(data.duration ?? 0),
      author: data.uploader ?? "未知作者",
      platform: "tiktok",
      streams: buildStreams(data),
      rawUrl: url,
    };
  },
};

export { runYtdlp };
