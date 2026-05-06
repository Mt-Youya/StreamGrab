import type { Platform } from "@streamgrab/types";

const PLATFORM_PATTERNS: Array<{ platform: Platform; pattern: RegExp }> = [
  { platform: "bilibili", pattern: /bilibili\.com|BV[a-zA-Z0-9]{10}/ },
  { platform: "douyin", pattern: /douyin\.com|v\.douyin\.com/ },
  { platform: "tiktok", pattern: /tiktok\.com/ },
  { platform: "youtube", pattern: /youtube\.com|youtu\.be/ },
];

export function detectPlatform(url: string): Platform | null {
  for (const { platform, pattern } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return platform;
  }
  return null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  bilibili: "Bilibili",
  douyin: "抖音",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  bilibili: "bg-blue-100 text-blue-800",
  douyin: "bg-black text-white",
  tiktok: "bg-pink-100 text-pink-800",
  youtube: "bg-red-100 text-red-800",
};
