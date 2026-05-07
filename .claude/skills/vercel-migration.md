---
name: vercel-migration
description: StreamGrab Vercel 改造完成状态、架构说明、本地模式 vs Vercel 模式对比
---

# StreamGrab Vercel 改造（已完成）

## 完成状态

| 任务 | 方案 | 状态 |
|------|------|------|
| SQLite 历史记录 | 改为 localStorage，删除 better-sqlite3 | ✅ |
| B站解析 | 纯 HTTP API（WBI 签名），移除 Playwright | ✅ |
| B站扫码登录 | 纯 HTTP fetch，移除 Playwright | ✅ |
| YouTube 解析 | `@distube/ytdl-core`（纯 JS），移除 yt-dlp | ✅ |
| TikTok 解析 | `@distube/ytdl-core`（纯 JS），移除 yt-dlp | ✅ |
| YouTube/TikTok 下载 | `ytdl` 流式下载，移除 yt-dlp | ✅ |
| 抖音解析 | Browserless API（Vercel）+ 本地 Playwright 自动切换 | ✅ |
| B站/YouTube 无声音（Vercel）| `@ffmpeg/ffmpeg` 浏览器端 wasm 合并 | ✅ |
| 环境依赖检测 | `/api/system-check` + 设置页「运行环境」卡片 | ✅ |

## 两种运行模式

### 本地模式（无 `VERCEL` 环境变量）

| 功能 | 依赖 | 说明 |
|------|------|------|
| B站解析 | 无 | 纯 HTTP |
| B站高清下载 | **FFmpeg**（可选）| 有则合并有声音，无则降级 ffmpeg-wasm |
| 抖音解析 | **Playwright + Chromium**（可选）| 有则本地运行，无则报错提示安装 |
| TikTok | 无 | ytdl-core |
| YouTube | 无（FFmpeg 可选）| ytdl-core 解析；下载需 FFmpeg 合并有声音 |

设置页「运行环境」卡片会实时检测并展示安装状态和安装命令。

### Vercel 模式（存在 `VERCEL` 环境变量）

| 功能 | 方案 |
|------|------|
| B站高清下载 | 服务端检测到 FFmpeg 不可用 → 返回 `needsClientMerge:true` → 前端 ffmpeg-wasm 合并 |
| 抖音解析 | Browserless HTTP API（需 `BROWSERLESS_TOKEN`）|
| TikTok / YouTube | ytdl-core，完全可用 |

## 关键架构文件

```
packages/parsers/src/
  youtube.ts    — @distube/ytdl-core 解析（H.264 优先）
  tiktok.ts     — @distube/ytdl-core 解析
  bilibili.ts   — 纯 HTTP（WBI 签名），未登录 480P，登录高清
  douyin.ts     — 接受外部 browserFetch 注入，不含浏览器代码

apps/web/lib/
  bilibili-browser.ts  — B站 session cookie + 扫码 HTTP API
  douyin-browser.ts    — 抖音：有 BROWSERLESS_TOKEN 走 Browserless，否则走本地 Playwright
  client-merge.ts      — 浏览器端 ffmpeg-wasm 合并（Vercel 无 FFmpeg 时使用）

apps/web/app/api/
  parse/route.ts        — 统一调度，注入 douyinBrowserFetch
  download/route.ts     — FFmpeg 可用时服务端合并；否则返回 needsClientMerge
  proxy/route.ts        — 视频流代理（供 ffmpeg-wasm 绕过 CORS）
  system-check/route.ts — 检测 FFmpeg/Playwright/Browserless 状态
  bilibili-login/       — 扫码登录 HTTP 实现
```

## Vercel 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BILIBILI_COOKIE` | 否 | B站 SESSDATA，不填最高 480P |
| `BROWSERLESS_TOKEN` | 抖音必填 | 免费获取：https://browserless.io（每月 6 小时）|
| `HTTP_PROXY` | TikTok 必填 | 如 `http://127.0.0.1:7890` |

## 本地安装指引（设置页会自动显示）

```bash
# FFmpeg（B站/YouTube 高清有声音）
brew install ffmpeg

# Playwright + Chromium（抖音解析）
pnpm --filter @streamgrab/web add playwright
npx playwright install chromium
```

## next.config.ts 关键配置

```ts
serverExternalPackages: ["playwright", "@distube/ytdl-core"]  // 不被 bundle
headers: COOP + COEP  // SharedArrayBuffer for ffmpeg-wasm
```
