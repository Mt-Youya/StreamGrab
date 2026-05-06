import { NextRequest, NextResponse } from "next/server";
import { createTask, setProgress, setStatus } from "@streamgrab/core";
import { sanitizeFilename } from "@/lib/utils";
import type { DownloadApiRequest, Platform } from "@streamgrab/types";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const PLATFORM_HEADERS: Record<string, Record<string, string>> = {
  bilibili: {
    Referer: "https://www.bilibili.com",
    "User-Agent": DESKTOP_UA,
  },
  douyin: {
    Referer: "https://www.douyin.com",
    "User-Agent": DESKTOP_UA,
  },
  tiktok: {
    Referer: "https://www.tiktok.com",
    "User-Agent": MOBILE_UA,
    Range: "bytes=0-",
  },
  youtube: {
    Referer: "https://www.youtube.com",
    "User-Agent": DESKTOP_UA,
  },
};

function detectPlatformFromUrl(url: string): string {
  if (/bilibili\.com|bilivideo\.(com|cn)|BV[a-zA-Z0-9]{10}/.test(url)) return "bilibili";
  if (/douyin\.com|douyinvod\.com|douyinpic\.com|v\.douyin\.com/.test(url)) return "douyin";
  if (/tiktok\.com|tiktokcdn\.com|tiktokv\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be|googlevideo\.com/.test(url)) return "youtube";
  return "bilibili";
}

/** 下载 URL 内容到本地临时文件，返回文件路径 */
async function downloadToTmp(url: string, headers: Record<string, string>, suffix: string): Promise<string> {
  const resp = await fetch(url, { headers });
  if (!resp.ok || !resp.body) {
    throw new Error(`下载失败 ${resp.status} ${resp.statusText}`);
  }
  const tmpPath = path.join(os.tmpdir(), `streamgrab_${uuidv4()}${suffix}`);
  const buf = await resp.arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(buf));
  return tmpPath;
}

/**
 * 用 yt-dlp 直接下载视频到临时文件。
 * outputTemplate: 不含扩展名的路径模板，yt-dlp 会自动加 .%(ext)s
 * 返回实际生成的文件路径。
 */
function ytdlpDownload(
  videoUrl: string,
  outputTemplate: string,  // 不含扩展名，如 /tmp/streamgrab_xxx
  proxy?: string,
  formatId?: string,
  outputFormat: string = "mp4",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = outputFormat.toLowerCase();
    let formatSelector: string;
    if (formatId) {
      formatSelector = formatId;
    } else if (ext === "webm") {
      formatSelector = "bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio/best";
    } else if (ext === "mkv") {
      formatSelector = "bestvideo+bestaudio/best";
    } else {
      formatSelector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best";
    }
    // 用 %(ext)s 让 yt-dlp 自动决定最终扩展名，避免扩展名冲突
    const outputPath = `${outputTemplate}.%(ext)s`;
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--merge-output-format", ext,
      "-f", formatSelector,
      "-o", outputPath,
      "--print", "after_move:filepath",  // 打印最终文件路径
      videoUrl,
    ];
    if (proxy) args.push("--proxy", proxy);
    console.log(`[download] yt-dlp format="${formatSelector.slice(0, 40)}" outputFormat=${ext}`);
    const env: NodeJS.ProcessEnv = { ...process.env, ...(proxy ? { HTTP_PROXY: proxy } : {}) };
    const proc = spawn("yt-dlp", args, { env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp 下载失败 code=${code}: ${stderr.slice(-300)}`));
        return;
      }
      // --print after_move:filepath 会输出实际路径
      const actualPath = stdout.trim().split("\n").pop()?.trim() ?? "";
      if (actualPath && fs.existsSync(actualPath)) {
        resolve(actualPath);
      } else {
        // fallback：尝试推测路径
        const guessed = `${outputTemplate}.${ext}`;
        if (fs.existsSync(guessed)) {
          resolve(guessed);
        } else {
          reject(new Error(`yt-dlp 下载完成但找不到输出文件（stdout: ${stdout.slice(-100)}）`));
        }
      }
    });
    proc.on("error", (err) => reject(new Error(`yt-dlp 启动失败: ${err.message}`)));
  });
}

/** 用 FFmpeg 合并视频和音频，输出到临时文件，返回路径 */
function mergeWithFFmpeg(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    ];
    console.log("[download] ffmpeg", args.join(" "));
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 退出码 ${code}: ${stderr.slice(-300)}`));
    });
    proc.on("error", (err) => reject(new Error(`FFmpeg 启动失败: ${err.message}`)));
  });
}

export async function POST(req: NextRequest) {
  const tmpFiles: string[] = [];

  try {
    const body = (await req.json()) as DownloadApiRequest;
    const { url, streamUrl, audioUrl, quality, filename, taskId, formatId } = body;
    const outputFormat = (body.outputFormat ?? "mp4").toLowerCase();
    const outputExt = `.${outputFormat}`;

    if (!streamUrl || !filename) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const id = taskId ?? uuidv4();
    const safeFilename = sanitizeFilename(filename);

    createTask(id, safeFilename);
    setStatus(id, "downloading");

    const platform = detectPlatformFromUrl(streamUrl || url || "");
    const headers = PLATFORM_HEADERS[platform] ?? PLATFORM_HEADERS["bilibili"];
    // 从 settings 读 proxy（前端传来）和 ytdlpPath
    const settingsProxy = (body as { proxy?: string }).proxy ?? process.env["HTTP_PROXY"];
    const ytdlpPath = (body as { ytdlpPath?: string }).ytdlpPath ?? process.env["YTDLP_PATH"] ?? "yt-dlp";

    console.log(`[download] platform=${platform} filename=${safeFilename} hasAudio=${!!audioUrl}`);

    // ── TikTok / YouTube：CDN URL 有 IP 绑定或需要 cookie，让 yt-dlp 用原页面 URL 直接下载 ──
    if ((platform === "tiktok" || platform === "youtube") && url) {
      console.log(`[download] ${platform}：使用 yt-dlp 直接下载 outputFormat=${outputFormat}`);
      const outputPath = path.join(os.tmpdir(), `streamgrab_${uuidv4()}${outputExt}`);
      tmpFiles.push(outputPath);
      // YouTube 优先选 H.264（QuickTime/iOS 兼容），除非用户手动指定了 formatId
      const resolvedFormatId = formatId ?? (platform === "youtube"
        ? "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
        : undefined);
      try {
        await ytdlpDownload(url, outputPath, settingsProxy, resolvedFormatId, outputFormat);
      } catch (err) {
        const msg = `${platform} 下载失败: ${(err as Error).message}`;
        console.error("[download]", msg);
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      if (!fs.existsSync(outputPath)) {
        setStatus(id, "error", "yt-dlp 未生成输出文件");
        return NextResponse.json({ error: "下载失败，未生成文件" }, { status: 500 });
      }
      const outputBuf = fs.readFileSync(outputPath);
      setStatus(id, "done");
      setProgress(id, 100);
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
      const dlFilename = safeFilename.endsWith(outputExt) ? safeFilename : safeFilename + outputExt;
      return new NextResponse(outputBuf, {
        headers: {
          "Content-Type": `video/${outputFormat}`,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename)}"`,
          "Content-Length": String(outputBuf.byteLength),
          "X-Task-Id": id,
          "X-Platform": platform,
        },
      });
    }

    // ── 有独立音频流（B站 DASH / YouTube）→ 用 FFmpeg 合并 ──
    if (audioUrl) {
      console.log("[download] DASH 模式：并行下载视频+音频，再用 FFmpeg 合并");
      setProgress(id, 5);

      // 并行下载
      let videoPath: string, audioPath: string;
      try {
        [videoPath, audioPath] = await Promise.all([
          downloadToTmp(streamUrl, headers, ".video.mp4"),
          downloadToTmp(audioUrl, headers, ".audio.m4a"),
        ]);
        tmpFiles.push(videoPath, audioPath);
      } catch (err) {
        const msg = `下载流失败: ${(err as Error).message}`;
        console.error("[download]", msg);
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      setProgress(id, 60);

      // FFmpeg 合并（使用用户选择的输出格式）
      const outputPath = path.join(os.tmpdir(), `streamgrab_${uuidv4()}${outputExt}`);
      tmpFiles.push(outputPath);
      try {
        await mergeWithFFmpeg(videoPath, audioPath, outputPath);
      } catch (err) {
        const msg = `合并音视频失败: ${(err as Error).message}`;
        console.error("[download]", msg);
        setStatus(id, "error", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      setProgress(id, 90);

      const outputBuf = fs.readFileSync(outputPath);
      const outputSize = outputBuf.byteLength;

      setStatus(id, "done");
      setProgress(id, 100);

      // 清理临时文件
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });

      const dlFilename2 = safeFilename.endsWith(outputExt) ? safeFilename : safeFilename + outputExt;
      return new NextResponse(outputBuf, {
        headers: {
          "Content-Type": `video/${outputFormat}`,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename2)}"`,
          "Content-Length": String(outputSize),
          "X-Task-Id": id,
        },
      });
    }

    // ── 无独立音频流（抖音、TikTok 等单流）→ 直接透传 ──
    let videoResp: Response;
    try {
      videoResp = await fetch(streamUrl, { headers });
    } catch (err) {
      const msg = `网络请求失败: ${(err as Error).message}`;
      console.error("[download] fetch threw:", err);
      setStatus(id, "error", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    console.log(`[download] response status=${videoResp.status} ${videoResp.statusText}`);

    if (!videoResp.ok || !videoResp.body) {
      let responseBody = "";
      try { responseBody = await videoResp.text(); } catch {}
      const msg = `视频流请求失败: ${videoResp.status} ${videoResp.statusText}`;
      console.error("[download]", msg);
      console.error("[download] response body (first 500):", responseBody.slice(0, 500));
      setStatus(id, "error", msg);
      return NextResponse.json({ error: msg, detail: responseBody.slice(0, 200) }, { status: 502 });
    }

    const contentLength = Number(videoResp.headers.get("content-length") ?? 0);
    const contentType = videoResp.headers.get("content-type") ?? "video/mp4";
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
            if (contentLength > 0) {
              setProgress(id, Math.round((downloaded / contentLength) * 100));
            }
          }
          setStatus(id, "done");
          setProgress(id, 100);
          controller.close();
        } catch (err) {
          setStatus(id, "error", (err as Error).message);
          controller.error(err);
        }
      },
    });

    const dlFilename3 = safeFilename.endsWith(outputExt) ? safeFilename : safeFilename + outputExt;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": `video/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(dlFilename3)}"`,
        "X-Task-Id": id,
        "X-Platform": platform,
        ...(contentLength > 0 ? { "Content-Length": String(contentLength) } : {}),
      },
    });
  } catch (err) {
    tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    console.error("[download] unexpected error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
