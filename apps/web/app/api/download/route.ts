import { NextRequest, NextResponse } from "next/server";
import { createTask, setProgress, setStatus } from "@streamgrab/core";
import { sanitizeFilename } from "@/lib/utils";
import type { DownloadApiRequest, Platform } from "@streamgrab/types";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ytdl = require("@distube/ytdl-core") as typeof import("@distube/ytdl-core");

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

/** 下载到临时文件（用于 Bilibili 音视频合并） */
async function downloadToTmp(url: string, headers: Record<string, string>, suffix: string): Promise<string> {
  const resp = await fetch(url, { headers });
  if (!resp.ok || !resp.body) throw new Error(`下载失败 ${resp.status} ${resp.statusText}`);
  const tmpPath = path.join(os.tmpdir(), `sg_${uuidv4()}${suffix}`);
  fs.writeFileSync(tmpPath, Buffer.from(await resp.arrayBuffer()));
  return tmpPath;
}

/** 用 ytdl 下载到临时文件（YouTube/TikTok，绕过 IP 绑定） */
async function ytdlDownloadToTmp(rawUrl: string, itag: number, suffix: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `sg_${uuidv4()}${suffix}`);
  return new Promise((resolve, reject) => {
    const stream = ytdl(rawUrl, { quality: itag });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      fs.writeFileSync(tmpPath, Buffer.concat(chunks));
      resolve(tmpPath);
    });
    stream.on("error", reject);
  });
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

  try {
    const body = (await req.json()) as DownloadApiRequest & { proxy?: string };
    const { url: rawUrl, streamUrl, audioUrl, filename, formatId } = body;
    const outputFormat = (body.outputFormat ?? "mp4").toLowerCase();
    const outputExt = `.${outputFormat}`;

    if (!streamUrl || !filename) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const id = body.taskId ?? uuidv4();
    const safeFilename = sanitizeFilename(filename);
    createTask(id, safeFilename);
    setStatus(id, "downloading");

    const platform = detectPlatformFromUrl(streamUrl);
    const headers = PLATFORM_HEADERS[platform] ?? PLATFORM_HEADERS["bilibili"]!;
    const dlFilename = safeFilename.endsWith(outputExt) ? safeFilename : safeFilename + outputExt;

    console.log(`[download] platform=${platform} hasAudio=${!!audioUrl} filename=${safeFilename}`);

    // ── YouTube / TikTok：用 ytdl 流式下载（绕过 googlevideo IP 绑定） ──
    if ((platform === "youtube" || platform === "tiktok") && rawUrl) {
      console.log(`[download] ${platform} ytdl 模式 formatId=${formatId}`);
      setProgress(id, 5);

      // formatId 格式：videoItag+audioItag 或 单itag
      const [videoItagStr, audioItagStr] = (formatId ?? "").split("+");
      const videoItag = Number(videoItagStr);
      const audioItag = audioItagStr ? Number(audioItagStr) : null;

      try {
        if (audioItag) {
          // 下载视频流 + 音频流，尝试 FFmpeg 合并
          const [videoPath, audioPath] = await Promise.all([
            ytdlDownloadToTmp(rawUrl, videoItag, ".video.mp4"),
            ytdlDownloadToTmp(rawUrl, audioItag, ".audio.m4a"),
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
              // Vercel 无 FFmpeg：降级为仅视频流，在响应头告知前端
              console.warn("[download] FFmpeg 不可用，返回仅视频流（无音频）");
              const videoBuf = fs.readFileSync(videoPath);
              setStatus(id, "done");
              setProgress(id, 100);
              tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
              return new NextResponse(videoBuf, {
                headers: {
                  "Content-Type": "video/mp4",
                  "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
                  "Content-Length": String(videoBuf.byteLength),
                  "X-Task-Id": id, "X-Platform": platform,
                  "X-Warning": "no-audio",
                },
              });
            }
            throw ffErr;
          }
        } else {
          // 单流（含音视频）
          const videoPath = await ytdlDownloadToTmp(rawUrl, videoItag, outputExt);
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
      let videoPath: string, audioPath: string;
      try {
        [videoPath, audioPath] = await Promise.all([
          downloadToTmp(streamUrl, headers, ".video.mp4"),
          downloadToTmp(audioUrl, headers, ".audio.m4a"),
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
          const videoBuf = fs.readFileSync(videoPath);
          setStatus(id, "done"); setProgress(id, 100);
          tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
          return new NextResponse(videoBuf, {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
              "Content-Length": String(videoBuf.byteLength),
              "X-Task-Id": id, "X-Warning": "no-audio",
            },
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

    // ── 抖音等单流 → 直接透传 ──
    let videoResp: Response;
    try {
      videoResp = await fetch(streamUrl, { headers });
    } catch (err) {
      const msg = `网络请求失败: ${(err as Error).message}`;
      setStatus(id, "error", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (!videoResp.ok || !videoResp.body) {
      const detail = await videoResp.text().catch(() => "");
      const msg = `视频流请求失败: ${videoResp.status} ${videoResp.statusText}`;
      setStatus(id, "error", msg);
      return NextResponse.json({ error: msg, detail: detail.slice(0, 200) }, { status: 502 });
    }

    const contentLength = Number(videoResp.headers.get("content-length") ?? 0);
    let downloaded = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = videoResp.body!.getReader();
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
