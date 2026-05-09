import { NextResponse } from "next/server";
import { execSync } from "node:child_process";

function checkCommand(cmd: string, versionArg = "--version"): { available: boolean; version?: string } {
  try {
    const out = execSync(`${cmd} ${versionArg} 2>&1`, { timeout: 5000, encoding: "utf8" });
    const version = out.split("\n")[0]?.trim().slice(0, 60);
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

function checkPlaywright(): { available: boolean; version?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("playwright/package.json") as { version: string };
    return { available: true, version: pkg.version };
  } catch {
    return { available: false };
  }
}

function isVercel() {
  return !!process.env["VERCEL"];
}

export async function GET() {
  const vercel = isVercel();

  const ffmpeg = checkCommand("ffmpeg", "-version");
  const playwright = checkPlaywright();
  const browserlessToken = !!process.env["BROWSERLESS_TOKEN"];

  // 各功能可用性判断
  const features = {
    bilibili_parse: { ok: true, note: "纯 HTTP API，无需额外依赖" },
    bilibili_hq: {
      ok: ffmpeg.available || vercel,
      note: ffmpeg.available
        ? `FFmpeg ${ffmpeg.version ?? "已安装"}`
        : vercel
        ? "Vercel 模式：浏览器端合并（ffmpeg-wasm）"
        : "需要安装 FFmpeg",
      install: !ffmpeg.available && !vercel ? "brew install ffmpeg  或  https://ffmpeg.org/download.html" : undefined,
    },
    douyin: {
      ok: playwright.available || browserlessToken,
      note: playwright.available
        ? `Playwright ${playwright.version ?? "已安装"}`
        : browserlessToken
        ? "Browserless Token 已配置"
        : vercel
        ? "需要配置 BROWSERLESS_TOKEN 环境变量"
        : "需要安装 Playwright + Chromium",
      install: !playwright.available && !browserlessToken && !vercel
        ? "pnpm --filter @streamgrab/web add playwright && npx playwright install chromium"
        : undefined,
    },
    tiktok: {
      ok: playwright.available || !!browserlessToken,
      note: playwright.available
        ? `Playwright ${playwright.version ?? "已安装"}`
        : browserlessToken
        ? "Browserless Token 已配置"
        : vercel
        ? "需要配置 BROWSERLESS_TOKEN 环境变量"
        : "需要安装 Playwright + Chromium（与抖音共用）",
      install: !playwright.available && !browserlessToken && !vercel
        ? "pnpm --filter @streamgrab/web add playwright && npx playwright install chromium"
        : undefined,
    },
    youtube: {
      ok: true,
      note: "@distube/ytdl-core 解析，" + (ffmpeg.available ? "FFmpeg 合并音视频" : vercel ? "浏览器端合并" : "需要 FFmpeg 才能有声音"),
    },
  };

  return NextResponse.json({
    isVercel: vercel,
    deps: { ffmpeg, playwright, browserlessToken },
    features,
  });
}
