"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  ffmpegInstance = ffmpeg;

  // 从 unpkg CDN 加载 ffmpeg-wasm 核心文件（支持 SharedArrayBuffer 的版本）
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return ffmpeg;
}

export interface ClientMergeOptions {
  videoUrl: string;
  audioUrl: string;
  filename: string;
  headers?: Record<string, string>;
  onProgress?: (ratio: number) => void;
}

/**
 * 在浏览器用 ffmpeg-wasm 合并视频+音频流，完成后触发下载
 */
export async function clientMergeAndDownload(opts: ClientMergeOptions): Promise<void> {
  const { videoUrl, audioUrl, filename, headers = {}, onProgress } = opts;

  onProgress?.(0.05);

  const ffmpeg = await getFFmpeg();

  // 下载视频和音频到 ffmpeg 虚拟文件系统
  ffmpeg.on("progress", ({ progress }) => {
    // progress 0~1，映射到 50%~95% 阶段（前 50% 是下载）
    onProgress?.(0.5 + progress * 0.45);
  });

  onProgress?.(0.1);
  // 通过服务端代理 fetch，避免 CORS 问题
  const proxy = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;
  const [videoData, audioData] = await Promise.all([
    fetchFile(proxy(videoUrl)),
    fetchFile(proxy(audioUrl)),
  ]);
  onProgress?.(0.5);

  await ffmpeg.writeFile("video.mp4", videoData);
  await ffmpeg.writeFile("audio.m4a", audioData);

  await ffmpeg.exec([
    "-i", "video.mp4",
    "-i", "audio.m4a",
    "-c:v", "copy",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "output.mp4",
  ]);
  onProgress?.(0.95);

  const data = await ffmpeg.readFile("output.mp4");
  // ffmpeg.readFile 返回 Uint8Array | string，统一转为 ArrayBuffer
  const arrayBuf = data instanceof Uint8Array
    ? data.buffer.slice(0) as ArrayBuffer  // slice(0) 得到普通 ArrayBuffer
    : new TextEncoder().encode(data as string).buffer as ArrayBuffer;
  const blob = new Blob([arrayBuf], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".mp4") ? filename : filename + ".mp4";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  // 清理虚拟文件系统
  await ffmpeg.deleteFile("video.mp4").catch(() => {});
  await ffmpeg.deleteFile("audio.m4a").catch(() => {});
  await ffmpeg.deleteFile("output.mp4").catch(() => {});

  onProgress?.(1);
}
