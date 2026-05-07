"use client";

import Image from "next/image";
import { useAppStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/detect-platform";
import { formatDuration } from "@/lib/utils";
import { Clock, User } from "lucide-react";

function toCoverSrc(cover: string, platform: string): string {
  if (platform === "bilibili" && cover) {
    return `/api/proxy?url=${encodeURIComponent(cover)}`;
  }
  return cover;
}

export function VideoPreview() {
  const video = useAppStore((s) => s.currentVideo);
  if (!video) return null;

  const coverSrc = toCoverSrc(video.cover, video.platform);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex gap-0 sm:flex-row flex-col">
          <div className="relative aspect-video w-full sm:w-56 shrink-0 bg-muted">
            {coverSrc ? (
              <Image
                src={coverSrc}
                alt={video.title}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
                无封面
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between p-4 flex-1 min-w-0">
            <div className="space-y-2">
              <div className="flex items-start gap-2 flex-wrap">
                <Badge className={PLATFORM_COLORS[video.platform]}>
                  {PLATFORM_LABELS[video.platform]}
                </Badge>
                <Badge variant="outline">{video.streams.length} 种画质</Badge>
              </div>
              <h2 className="font-semibold text-base leading-snug line-clamp-2">{video.title}</h2>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {video.author}
                </span>
                {video.duration > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(video.duration)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
