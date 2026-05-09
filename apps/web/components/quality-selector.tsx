"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useAppStore } from "@/lib/store";
import { sanitizeFilename, formatFileSize } from "@/lib/utils";
import type { DownloadApiRequest } from "@streamgrab/types";
import { v4 as uuidv4 } from "uuid";
import { Download, Lock, Cpu } from "lucide-react";
import { insertHistory } from "@/lib/db";

// 各平台支持的输出格式
const FORMAT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  bilibili: [
    { value: "mp4", label: "MP4（推荐）" },
    { value: "mkv", label: "MKV" },
  ],
  douyin: [{ value: "mp4", label: "MP4" }],
  tiktok: [
    { value: "mp4", label: "MP4（推荐）" },
    { value: "mkv", label: "MKV" },
    { value: "webm", label: "WebM" },
  ],
  youtube: [
    { value: "mp4", label: "MP4 / H.264（QuickTime 兼容）" },
    { value: "mkv", label: "MKV（保留原始编码）" },
    { value: "webm", label: "WebM" },
  ],
};

export function QualitySelector() {
  const video = useAppStore((s) => s.currentVideo);
  const addToQueue = useAppStore((s) => s.addToQueue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [downloading, setDownloading] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0); // 0 = 未合并，>0 = 合并中

  if (!video || video.streams.length === 0) return null;

  const selected = video.streams[selectedIndex] ?? video.streams[0];
  const formatOptions = FORMAT_OPTIONS[video.platform] ?? FORMAT_OPTIONS["bilibili"];

  // 切换画质时重置格式为该平台默认值
  function handleQualityChange(idx: number) {
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

      if (!resp.ok) {
        throw new Error("下载请求失败");
      }

      const contentType = resp.headers.get("content-type") ?? "";

      // 服务端 FFmpeg 不可用时，返回 JSON 要求客户端合并
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
          setMergeProgress(0.01); // 触发合并进度显示

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

  const isLocked = !!selected?.locked;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* 画质选择 */}
      <Select
        value={String(selectedIndex)}
        onChange={(e) => handleQualityChange(Number(e.target.value))}
        className="w-52"
      >
        {video.streams.map((stream, i) => (
          <option key={i} value={i}>
            {stream.locked ? "🔒 " : ""}
            {stream.label}
            {stream.size ? ` (${formatFileSize(stream.size)})` : ""}
          </option>
        ))}
      </Select>

      {/* 格式选择 */}
      {!isLocked && formatOptions.length > 1 && (
        <Select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="w-52">
          {formatOptions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      )}

      {/* 下载按钮 */}
      <Button
        onClick={handleDownload}
        disabled={downloading || isLocked || mergeProgress > 0}
        className="gap-2"
        variant={isLocked ? "outline" : "default"}
      >
        {isLocked ? (
          <Lock className="h-4 w-4" />
        ) : mergeProgress > 0 ? (
          <Cpu className="h-4 w-4 animate-pulse" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {mergeProgress > 0
          ? `浏览器合并中 ${Math.round(mergeProgress * 100)}%`
          : downloading
            ? "下载中..."
            : isLocked
              ? "需要权限"
              : "下载"}
      </Button>

      {/* 分辨率提示 */}
      {selected?.width && selected.height && !isLocked && mergeProgress === 0 && (
        <span className="text-xs text-muted-foreground">
          {selected.width}×{selected.height}
        </span>
      )}

      {/* 客户端合并提示 */}
      {mergeProgress > 0 && (
        <span className="text-xs text-blue-600 dark:text-blue-400">正在浏览器中合并音视频，请稍候...</span>
      )}

      {/* 锁定提示 */}
      {isLocked && selected?.lockReason && (
        <span className="text-xs text-amber-600 dark:text-amber-400">{selected.lockReason}</span>
      )}
    </div>
  );
}
