import { NextRequest, NextResponse } from "next/server";
import { createTask, setProgress, setStatus } from "@streamgrab/core";
import { sanitizeFilename } from "@/lib/utils";
import type { DownloadApiRequest, Platform } from "@streamgrab/types";
import { proxyDownloadStream } from "@streamgrab/parsers";
import { deleteCached } from "@/lib/parse-cache";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PLATFORM_HEADERS: Record<string, Record<string, string>> = {
  bilibili: { Referer: "https://www.bilibili.com", "User-Agent": DESKTOP_UA },
  douyin:   { Referer: "https://www.douyin.com",   "User-Agent": DESKTOP_UA },
  tiktok:   { Referer: "https://www.tiktok.com",   "User-Agent": DESKTOP_UA },
  youtube:  { Referer: "https://www.youtube.com",  "User-Agent": DESKTOP_UA },
};

function detectPlatformFromUrl(url: string): Platform {
  if (/bilibili\.com|bilivideo\.(com|cn)/.test(url)) return "bilibili";
  if (/douyin\.com|douyinvod\.com/.test(url)) return "douyin";
  if (/tiktok\.com|tiktokcdn\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be|googlevideo\.com/.test(url)) return "youtube";
  return "bilibili";
}

/** 流式下载到临时文件，支持进度回调和代理 */
async function downloadToTmp(
  url: string,
  headers: Record<string, string>,
  suffix: string,
  onProgress?: (downloaded: number, total: number) => void,
  proxy?: string,
): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `sg_${uuidv4()}${suffix}`);

  if (proxy) {
    // 走代理：CONNECT 隧道流式下载
    const writeStream = fs.createWriteStream(tmpPath);
    let downloaded = 0;
    let total = 0;
    await proxyDownloadStream(url, proxy, headers, (chunk, contentLength) => {
      if (contentLength > 0 && total === 0) total = contentLength;
      writeStream.write(chunk);
      downloaded += chunk.byteLength;
      onProgress?.(downloaded, total);
    });
    await new Promise<void>((res, rej) => {
      writeStream.end();
      writeStream.on("finish", res);
      writeStream.on("error", rej);
    });
    return tmpPath;
  }

  // 无代理：原有 fetch 逻辑
  const resp = await fetch(url, { headers });
  if (!resp.ok || !resp.body) throw new Error(`下载失败 ${resp.status} ${resp.statusText}`);
  const total = Number(resp.headers.get("content-length") ?? 0);
  const writeStream = fs.createWriteStream(tmpPath);
  const reader = resp.body.getReader();
  let downloaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(value);
      downloaded += value.byteLength;
      onProgress?.(downloaded, total);
    }
  } finally {
    writeStream.end();
    await new Promise<void>((res, rej) => {
      writeStream.on("finish", res);
      writeStream.on("error", rej);
    });
  }
  return tmpPath;
}

/**
 * 代理优先，直链兜底：有代理先走代理，失败再走直链
 * 临时文件由内部 downloadToTmp 创建，调用方负责清理
 */
async function downloadWithFallback(
  url: string,
  headers: Record<string, string>,
  suffix: string,
  onProgress?: (downloaded: number, total: number) => void,
  proxy?: string,
): Promise<string> {
  if (proxy) {
    try {
      console.log(`[download] 尝试代理下载 proxy=${proxy}`);
      const tmpPath = await downloadToTmp(url, headers, suffix, onProgress, proxy);
      console.log(`[download] 代理下载成功`);
      return tmpPath;
    } catch (proxyErr) {
      console.warn(`[download] 代理下载失败（${(proxyErr as Error).message}），回退直链重试...`);
      const tmpPath = await downloadToTmp(url, headers, suffix, onProgress, undefined);
      console.log(`[download] 直链下载成功`);
      return tmpPath;
    }
  }
  return downloadToTmp(url, headers, suffix, onProgress, undefined);
}


function mergeWithFFmpeg(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", videoPath, "-i", audioPath,
      "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart",
      outputPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 退出码 ${code}: ${stderr.slice(-300)}`));
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") reject(new Error("FFMPEG_NOT_FOUND"));
      else reject(new Error(`FFmpeg 启动失败: ${err.message}`));
    });
  });
}

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = [];
  let _rawUrl = "";
  let _platform = "";

  try {
    const body = (await req.json()) as DownloadApiRequest & { proxy?: string; mimeType?: string };
    const { url: rawUrl, streamUrl, audioUrl, filename, formatId } = body;
    _rawUrl = rawUrl ?? "";
    _platform = detectPlatformFromUrl(streamUrl ?? "");
    // 根据 mimeType 决定视频临时文件容器（VP9/AV1 用 webm，H.264/H.265 用 mp4）
    const videoMime = (body.mimeType ?? "video/mp4").toLowerCase();
    const videoTmpExt = videoMime.includes("webm") ? ".video.webm" : ".video.mp4";
    const outputFormat = (body.outputFormat ?? "mp4").toLowerCase();
    const outputExt = `.${outputFormat}`;

    if (!streamUrl || !filename) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const id = body.taskId ?? uuidv4();
    const safeFilename = sanitizeFilename(filename);
    createTask(id, safeFilename);
    setStatus(id, "downloading");

    const proxy = body.proxy ?? process.env["HTTP_PROXY"] ?? process.env["http_proxy"];
    const platform = detectPlatformFromUrl(streamUrl);
    const headers = PLATFORM_HEADERS[platform] ?? PLATFORM_HEADERS["bilibili"]!;
    const dlFilename = safeFilename.endsWith(outputExt) ? safeFilename : safeFilename + outputExt;

    console.log(`[download] platform=${platform} hasAudio=${!!audioUrl} filename=${safeFilename} proxy=${proxy ?? "无"}`);

    // ── YouTube：streamUrl/audioUrl 已是 googlevideo 直链，走代理直接下载 ──
    if (platform === "youtube") {
      console.log(`[download] youtube 直链模式 hasAudio=${!!audioUrl}`);
      setProgress(id, 5);

      const ytHeaders = { ...PLATFORM_HEADERS["youtube"]! };

      try {
        if (audioUrl) {
          // 视频流 + 音频流，FFmpeg 合并
          let videoTotal = 0, audioTotal = 0, videoDl = 0, audioDl = 0;
          function refreshProgress() {
            const total = videoTotal + audioTotal;
            if (total <= 0) return;
            setProgress(id, Math.min(Math.round(((videoDl + audioDl) / total) * 50) + 5, 55));
          }
          const [videoPath, audioPath] = await Promise.all([
            downloadWithFallback(streamUrl, ytHeaders, videoTmpExt, (dl, total) => {
              videoDl = dl; videoTotal = total || videoTotal; refreshProgress();
            }, proxy),
            downloadWithFallback(audioUrl, ytHeaders, ".audio.m4a", (dl, total) => {
              audioDl = dl; audioTotal = total || audioTotal; refreshProgress();
            }, proxy),
          ]);
          tmpFiles.push(videoPath, audioPath);
          setProgress(id, 60);

          const outputPath = path.join(os.tmpdir(), `sg_${uuidv4()}${outputExt}`);
          tmpFiles.push(outputPath);

          try {
            await mergeWithFFmpeg(videoPath, audioPath, outputPath);
            const buf = fs.readFileSync(outputPath);
            setStatus(id, "done");
            setProgress(id, 100);
            tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
            return new NextResponse(buf, {
              headers: {
                "Content-Type": `video/${outputFormat}`,
                "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
                "Content-Length": String(buf.byteLength),
                "X-Task-Id": id, "X-Platform": platform,
              },
            });
          } catch (ffErr) {
            if ((ffErr as Error).message === "FFMPEG_NOT_FOUND") {
              console.warn("[download] FFmpeg 不可用，通知前端进行客户端合并");
              setStatus(id, "done");
              tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
              return NextResponse.json({
                needsClientMerge: true,
                videoUrl: streamUrl,
                audioUrl,
                filename: dlFilename,
                platform,
                headers: ytHeaders,
              });
            }
            throw ffErr;
          }
        } else {
          // 单流（含音视频）
          const videoPath = await downloadWithFallback(streamUrl, ytHeaders, outputExt, undefined, proxy);
          tmpFiles.push(videoPath);
          const buf = fs.readFileSync(videoPath);
          setStatus(id, "done");
          setProgress(id, 100);
          tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
          return new NextResponse(buf, {
            headers: {
              "Content-Type": `video/${outputFormat}`,
              "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
              "Content-Length": String(buf.byteLength),
              "X-Task-Id": id, "X-Platform": platform,
            },
          });
        }
      } catch (err) {
        const msg = `${platform} 下载失败: ${(err as Error).message}`;
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // ── B站 DASH（有独立音频流）→ fetch 两流 + FFmpeg 合并 ──
    if (audioUrl) {
      setProgress(id, 5);
      // 视频+音频并发下载，实时合并进度映射到 5%~55%
      let videoTotal = 0, audioTotal = 0, videoDl = 0, audioDl = 0;
      function refreshProgress() {
        const total = videoTotal + audioTotal;
        if (total <= 0) return;
        const pct = Math.round(((videoDl + audioDl) / total) * 50) + 5;
        setProgress(id, Math.min(pct, 55));
      }
      let videoPath: string, audioPath: string;
      try {
        [videoPath, audioPath] = await Promise.all([
          downloadWithFallback(streamUrl, headers, videoTmpExt, (dl, total) => {
            videoDl = dl; videoTotal = total || videoTotal; refreshProgress();
          }, proxy),
          downloadWithFallback(audioUrl, headers, ".audio.m4a", (dl, total) => {
            audioDl = dl; audioTotal = total || audioTotal; refreshProgress();
          }, proxy),
        ]);
        tmpFiles.push(videoPath, audioPath);
      } catch (err) {
        const msg = `下载流失败: ${(err as Error).message}`;
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      setProgress(id, 60);

      const outputPath = path.join(os.tmpdir(), `sg_${uuidv4()}${outputExt}`);
      tmpFiles.push(outputPath);
      try {
        await mergeWithFFmpeg(videoPath, audioPath, outputPath);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "FFMPEG_NOT_FOUND") {
          // Vercel 无 FFmpeg：通知前端用 ffmpeg-wasm 在浏览器端合并
          setStatus(id, "done");
          tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
          return NextResponse.json({
            needsClientMerge: true,
            videoUrl: streamUrl,
            audioUrl,
            filename: dlFilename,
            platform,
            headers,
          });
        }
        setStatus(id, "error", msg);
        return NextResponse.json({ error: `合并音视频失败: ${msg}` }, { status: 500 });
      }
      setProgress(id, 90);
      const outputBuf = fs.readFileSync(outputPath);
      setStatus(id, "done"); setProgress(id, 100);
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
      return new NextResponse(outputBuf, {
        headers: {
          "Content-Type": `video/${outputFormat}`,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
          "Content-Length": String(outputBuf.byteLength),
          "X-Task-Id": id,
        },
      });
    }

    // ── 抖音等单流 ──
    if (proxy) {
      // 有代理：代理优先下载到临时文件，失败自动回退直链
      let videoPath: string;
      try {
        videoPath = await downloadWithFallback(streamUrl, headers, outputExt, (dl, total) => {
          if (total > 0) setProgress(id, Math.round((dl / total) * 100));
        }, proxy);
      } catch (err) {
        const msg = `网络请求失败: ${(err as Error).message}`;
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      tmpFiles.push(videoPath);
      const buf = fs.readFileSync(videoPath);
      setStatus(id, "done"); setProgress(id, 100);
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
      return new NextResponse(buf, {
        headers: {
          "Content-Type": `video/${outputFormat}`,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
          "Content-Length": String(buf.byteLength),
          "X-Task-Id": id,
        },
      });
    }

    // 无代理：直接流式透传（性能最优）；若失败，再走临时文件兜底
    let videoResp: Response | null = null;
    try {
      videoResp = await fetch(streamUrl, { headers });
    } catch (fetchErr) {
      console.warn(`[download] 直链 fetch 失败（${(fetchErr as Error).message}），尝试临时文件模式...`);
    }

    if (!videoResp || !videoResp.ok || !videoResp.body) {
      // 直链 fetch 失败或响应异常，兜底走临时文件下载
      if (videoResp && !videoResp.ok) {
        const detail = await videoResp.text().catch(() => "");
        console.warn(`[download] 直链响应异常 ${videoResp.status}，兜底临时文件... detail=${detail.slice(0, 100)}`);
      }
      let videoPath: string;
      try {
        videoPath = await downloadToTmp(streamUrl, headers, outputExt, (dl, total) => {
          if (total > 0) setProgress(id, Math.round((dl / total) * 100));
        });
      } catch (err) {
        const msg = `网络请求失败: ${(err as Error).message}`;
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      tmpFiles.push(videoPath);
      const buf = fs.readFileSync(videoPath);
      setStatus(id, "done"); setProgress(id, 100);
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
      return new NextResponse(buf, {
        headers: {
          "Content-Type": `video/${outputFormat}`,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
          "Content-Length": String(buf.byteLength),
          "X-Task-Id": id,
        },
      });
    }

    const contentLength = Number(videoResp.headers.get("content-length") ?? 0);
    let downloaded = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = videoResp!.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            downloaded += value.byteLength;
            if (contentLength > 0) setProgress(id, Math.round((downloaded / contentLength) * 100));
          }
          setStatus(id, "done"); setProgress(id, 100);
          controller.close();
        } catch (err) {
          setStatus(id, "error", (err as Error).message);
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": `video/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
        "X-Task-Id": id,
        ...(contentLength > 0 ? { "Content-Length": String(contentLength) } : {}),
      },
    });
  } catch (err) {
    tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    console.error("[download] unexpected error:", err);

    // 流地址失效时清除解析缓存，下次强制重新解析
    const errMsg = (err as Error).message ?? "";
    if (_rawUrl && _platform && /下载失败|4\d\d|502/i.test(errMsg)) {
      deleteCached(_rawUrl, _platform).catch(() => {});
    }

    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
