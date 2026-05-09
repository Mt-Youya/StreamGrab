"use client";

import Image from "next/image";
import { useAppStore } from "@/lib/store";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/detect-platform";
import { formatDuration } from "@/lib/utils";
import { Clock, User } from "lucide-react";

function toCoverSrc(cover: string, proxy?: string): string {
  if (!cover) return cover;
  const p = proxy ? `&proxy=${encodeURIComponent(proxy)}` : "";
  return `/api/proxy?url=${encodeURIComponent(cover)}${p}`;
}

export function VideoPreview() {
  const video = useAppStore((s) => s.currentVideo);
  if (!video) return null;

  let httpProxy: string | undefined;
  try {
    const raw = localStorage.getItem("streamgrab_settings");
    if (raw) httpProxy = (JSON.parse(raw) as Record<string, string>)["httpProxy"] || undefined;
  } catch {}

  const coverSrc = toCoverSrc(video.cover, httpProxy);

  return (
    <div className="flex gap-4 sm:flex-row flex-col border-b border-border pb-4">
      {/* 缩略图 */}
      <div className="relative aspect-video w-full sm:w-44 shrink-0 rounded-md overflow-hidden bg-muted">
        {coverSrc ? (
          <Image src={coverSrc} alt={video.title} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
            无封面
          </div>
        )}
      </div>

      {/* 信息区 */}
      <div className="flex flex-col justify-center gap-2 min-w-0 py-0.5">
        {/* 平台标签 + 画质数 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono ${PLATFORM_COLORS[video.platform]}`}
          >
            {PLATFORM_LABELS[video.platform]}
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {video.streams.length} 种画质
          </span>
        </div>

        {/* 标题 */}
        <h2 className="font-semibold text-sm leading-snug line-clamp-2 text-foreground">
          {video.title}
        </h2>

        {/* 作者 + 时长 */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" aria-hidden="true" />
            {video.author}
          </span>
          {video.duration > 0 && (
            <span className="flex items-center gap-1 font-mono tabular-nums">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatDuration(video.duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
