"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { sanitizeFilename, formatFileSize } from "@/lib/utils";
import type { DownloadApiRequest } from "@streamgrab/types";
import { v4 as uuidv4 } from "uuid";
import { Download, Lock, Cpu, ChevronDown } from "lucide-react";
import { insertHistory } from "@/lib/db";
import { cn } from "@/lib/utils";
import Link from "next/link";

// 各平台支持的输出格式
const FORMAT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  bilibili: [
    { value: "mp4", label: "MP4" },
    { value: "mkv", label: "MKV" },
  ],
  douyin: [{ value: "mp4", label: "MP4" }],
  tiktok: [
    { value: "mp4", label: "MP4" },
    { value: "mkv", label: "MKV" },
    { value: "webm", label: "WebM" },
  ],
  youtube: [
    { value: "mp4", label: "MP4" },
    { value: "mkv", label: "MKV" },
    { value: "webm", label: "WebM" },
  ],
};

export function QualitySelector() {
  const video = useAppStore((s) => s.currentVideo);
  const addToQueue = useAppStore((s) => s.addToQueue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [downloading, setDownloading] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [lockedHint, setLockedHint] = useState<number | null>(null);

  if (!video || video.streams.length === 0) return null;

  const selected = video.streams[selectedIndex] ?? video.streams[0];
  const formatOptions = FORMAT_OPTIONS[video.platform] ?? FORMAT_OPTIONS["bilibili"];
  const isLocked = !!selected?.locked;
  const isBusy = downloading || mergeProgress > 0;

  function handleQualityChange(idx: number) {
    const stream = video!.streams[idx];
    if (stream?.locked) {
      setLockedHint(idx);
      setSelectedIndex(idx);
      return;
    }
    setLockedHint(null);
    setSelectedIndex(idx);
    setOutputFormat(formatOptions[0].value);
  }

  async function handleDownload() {
    if (!selected || !video) return;
    setDownloading(true);

    const taskId = uuidv4();
    const filename = sanitizeFilename(`${video.title}_${selected.quality}`);

    addToQueue({
      taskId,
      status: "pending",
      progress: 0,
      filename,
      createdAt: Date.now(),
    });

    try {
      let settings: Record<string, string> = {};
      try {
        const raw = localStorage.getItem("streamgrab_settings");
        if (raw) settings = JSON.parse(raw) as Record<string, string>;
      } catch {}

      const body: DownloadApiRequest = {
        url: video.rawUrl,
        streamUrl: selected.url,
        audioUrl: selected.audioUrl,
        quality: selected.quality,
        filename,
        taskId,
        formatId: selected.formatId || undefined,
        outputFormat,
        mimeType: selected.mimeType || undefined,
        proxy: settings["httpProxy"] || undefined,
        ytdlpPath: settings["ytdlpPath"] || undefined,
      };

      const resp = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) throw new Error("下载请求失败");

      const contentType = resp.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const json = (await resp.json()) as {
          needsClientMerge?: boolean;
          videoUrl?: string;
          audioUrl?: string;
          filename?: string;
          platform?: string;
        };

        if (json.needsClientMerge && json.videoUrl && json.audioUrl) {
          setDownloading(false);
          setMergeProgress(0.01);

          const { clientMergeAndDownload } = await import("@/lib/client-merge");
          await clientMergeAndDownload({
            videoUrl: json.videoUrl,
            audioUrl: json.audioUrl,
            filename: json.filename ?? filename,
            onProgress: setMergeProgress,
          });

          insertHistory({
            id: uuidv4(),
            title: video.title,
            platform: (json.platform ?? "bilibili") as import("@streamgrab/types").Platform,
            quality: selected.quality,
            url: video.rawUrl,
            filename: json.filename ?? filename,
            cover: video.cover,
            createdAt: Date.now(),
          });

          setMergeProgress(0);
          return;
        }

        throw new Error(json.videoUrl ? "合并参数不完整" : "下载失败");
      }

      if (!resp.body) throw new Error("响应体为空");

      const contentDisposition = resp.headers.get("content-disposition") ?? "";
      const filenamePart = contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? filename;
      const platform = resp.headers.get("x-platform") ?? "bilibili";
      const blob = await resp.blob();

      insertHistory({
        id: uuidv4(),
        title: video.title,
        platform: platform as import("@streamgrab/types").Platform,
        quality: selected.quality,
        url: video.rawUrl,
        filename: decodeURIComponent(filenamePart),
        size: blob.size,
        cover: video.cover,
        createdAt: Date.now(),
      });

      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = decodeURIComponent(filenamePart);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (err) {
      console.error("下载失败:", err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 画质 chip 列表 */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="选择画质">
        {video.streams.map((stream, i) => {
          const active = selectedIndex === i;
          const locked = !!stream.locked;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleQualityChange(i)}
              disabled={isBusy}
              aria-pressed={active}
              aria-label={`${stream.label}${stream.size ? `，${formatFileSize(stream.size)}` : ""}${locked ? "，需要权限" : ""}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                "font-mono tabular-nums",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                "disabled:cursor-not-allowed",
                active && !locked
                  ? "border-[#4fffb0] text-[#4fffb0] bg-[rgba(79,255,176,0.08)]"
                  : locked
                    ? "border-border text-muted-foreground/50 bg-transparent"
                    : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground bg-transparent"
              )}
            >
              {locked && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
              <span className="font-medium">{stream.label}</span>
              {stream.size && (
                <span className="text-xs opacity-60">
                  {formatFileSize(stream.size)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 锁定提示：内联展开，不用 modal */}
      {lockedHint !== null && video.streams[lockedHint]?.locked && (
        <p className="text-xs text-amber-500/80">
          {video.streams[lockedHint]?.lockReason ?? "需要登录才能下载此画质"}
          {video.platform === "bilibili" && (
            <>
              {" "}
              <Link
                href="/settings"
                className="underline underline-offset-2 hover:text-amber-400 transition-colors"
              >
                前往设置扫码登录
              </Link>
            </>
          )}
        </p>
      )}

      {/* 格式 chip 列表（多于一个时显示）*/}
      {!isLocked && formatOptions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">格式</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="输出格式">
            {formatOptions.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setOutputFormat(f.value)}
                disabled={isBusy}
                aria-pressed={outputFormat === f.value}
                className={cn(
                  "inline-flex items-center rounded px-2.5 py-1 text-xs font-mono transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  "disabled:cursor-not-allowed",
                  outputFormat === f.value
                    ? "bg-foreground/10 text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 border border-transparent"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 分辨率 + 下载按钮行 */}
      <div className="flex items-center gap-3 flex-wrap">
        {selected?.width && selected.height && !isLocked && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {selected.width}×{selected.height}
          </span>
        )}

        <button
          type="button"
          onClick={handleDownload}
          disabled={isBusy || isLocked}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            isLocked
              ? "border border-border text-muted-foreground cursor-not-allowed"
              : isBusy
                ? "bg-foreground/10 text-muted-foreground cursor-wait"
                : "bg-foreground text-background hover:bg-[#4fffb0] hover:text-background"
          )}
        >
          {isLocked ? (
            <Lock className="h-4 w-4" aria-hidden="true" />
          ) : mergeProgress > 0 ? (
            <Cpu className="h-4 w-4 animate-pulse" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          <span>
            {mergeProgress > 0
              ? `合并中 ${Math.round(mergeProgress * 100)}%`
              : downloading
                ? "下载中..."
                : isLocked
                  ? "需要权限"
                  : "下载"}
          </span>
        </button>

        {/* 合并说明 */}
        {mergeProgress > 0 && (
          <span className="text-xs text-muted-foreground">
            浏览器合并音视频，请稍候
          </span>
        )}
      </div>
    </div>
  );
}
