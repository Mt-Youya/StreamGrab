"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import { detectPlatform } from "@/lib/detect-platform";
import type { ParseApiResponse } from "@streamgrab/types";
import { Loader2, Search } from "lucide-react";

export function DownloadForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCurrentVideo = useAppStore((s) => s.setCurrentVideo);

  async function handleParse() {
    const trimmed = url.trim();
    if (!trimmed) return;

    const platform = detectPlatform(trimmed);
    if (!platform) {
      setError("不支持该链接，请粘贴 Bilibili、抖音、TikTok 或 YouTube 的视频链接");
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentVideo(null);

    try {
      // 从 localStorage 读取用户配置
      let settings: Record<string, string> = {};
      try {
        const raw = localStorage.getItem("streamgrab_settings");
        if (raw) settings = JSON.parse(raw) as Record<string, string>;
      } catch {}

      const resp = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          cookie: settings["bilibiliCookie"] || undefined,
          douyinCookieFile: settings["douyinCookieFile"] || undefined,
          proxy: settings["httpProxy"] || undefined,
          ytdlpPath: settings["ytdlpPath"] || undefined,
        }),
      });
      const data: ParseApiResponse = await resp.json();
      if (data.success && data.data) {
        setCurrentVideo(data.data);
      } else {
        setError(data.error ?? "解析失败，请检查链接是否有效");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleParse();
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="粘贴 Bilibili、抖音、TikTok 或 YouTube 视频链接..."
          className="h-12 text-base"
          disabled={loading}
        />
        <Button onClick={handleParse} disabled={loading || !url.trim()} className="h-12 px-6">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "解析中..." : "解析"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        支持平台：Bilibili · 抖音 · TikTok · YouTube
      </p>
    </div>
  );
}
