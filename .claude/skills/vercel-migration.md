---
name: vercel-migration
description: 将 StreamGrab 改造为 Vercel 兼容版本
---

# StreamGrab Vercel 改造

将 StreamGrab 项目从依赖本地系统工具（yt-dlp、ffmpeg、Playwright）改造为可部署到 Vercel 的纯 JS 版本。

## 背景

项目位于 `/Users/yonjay/codes/ClaudeCode/StreamGrab`，是一个 pnpm Monorepo：
- `packages/parsers/` — 各平台视频解析器
- `packages/types/` — 共享类型
- `apps/web/` — Next.js 15 前端

## 待改造的 7 项任务

### 1. YouTube 解析：yt-dlp → @distube/ytdl-core

替换 `packages/parsers/src/youtube.ts`：
- 移除 `runYtdlp` 调用
- 改用已安装的 `@distube/ytdl-core` 获取视频信息和格式列表
- 保留 H.264 优先逻辑（`codecPriority` 函数）
- 保留 `formatId` 字段传递（用于下载时指定格式）

### 2. TikTok 解析：yt-dlp → 纯 JS

替换 `packages/parsers/src/tiktok.ts`：
- 用 `@distube/ytdl-core` 或直接调用 TikTok API 解析视频信息
- 获取视频流 URL 和必要的 headers/cookies
- 保留多画质列表

### 3. 抖音解析：Playwright → Browserless

替换 `apps/web/lib/douyin-browser.ts`：
- 当前用 Playwright 启动本地 Chromium 访问抖音页面，拦截 detail API 响应
- 改为调用 [Browserless](https://browserless.io) 云端 API（`wss://chrome.browserless.io`）
- 环境变量 `BROWSERLESS_TOKEN` 存放 API token
- 逻辑不变：访问视频页，拦截 `/aweme/v1/web/aweme/detail/` 响应体

### 4. B站解析：Playwright → Browserless

替换 `apps/web/lib/bilibili-browser.ts`：
- 当前用 Playwright + `addInitScript`（反检测）+ 读 `window.__playinfo__`
- 改为 Browserless API，注入同样的反检测脚本
- 保留扫码登录逻辑（cookie 注入到 Browserless context）

### 5. 下载架构：服务端转发 → 前端直接下载

当前 `apps/web/app/api/download/route.ts` 在服务端下载视频再返回给前端，Vercel 60s 超时。

改造方案：
- 服务端 `/api/download` 只返回视频流的 URL + 必要请求头（Referer、Cookie 等）
- 前端用 `fetch` + `ReadableStream` 直接下载到本地
- 需要处理 CORS（部分平台需要服务端代理请求头）
- B站 DASH 双流问题：返回两个 URL，前端用 `MediaSource API` 或提示用户安装扩展

### 6. SQLite → localStorage / Vercel KV

替换 `apps/web/lib/db.ts`：
- 移除 `better-sqlite3` 依赖
- 历史记录改用 `localStorage`（纯前端，无需服务端）
- 或接入 Vercel KV（需要 `VERCEL_KV_*` 环境变量）
- 更新 `apps/web/app/api/history/` 路由

### 7. FFmpeg 合并 → 客户端方案

当前服务端用 `spawn('ffmpeg')` 合并 B站 DASH 音视频。

改造方案：
- 前端用 `ffmpeg.wasm`（`@ffmpeg/ffmpeg`）在浏览器内合并
- 或：提供两个独立下载链接（视频流 + 音频流），用户自行合并
- 或：仅支持 B站非 DASH 格式（480P 以下单流，无需合并）

## 完成标准

改造完成后，运行 `vercel build` 不报错，且：
- 无 `spawn` 系统进程调用
- 无本地文件读写（除 `/tmp` 外）
- 无 `better-sqlite3` 原生模块
- Playwright 依赖改为 Browserless HTTP 调用
- 所有 API 路由在 30s 内响应
