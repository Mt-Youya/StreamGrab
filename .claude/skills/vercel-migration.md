---
name: vercel-migration
description: StreamGrab Vercel 改造进度与剩余任务
---

# StreamGrab Vercel 改造

## 已完成

| 任务 | 方案 |
|------|------|
| ✅ SQLite 历史记录 | 改为 localStorage，删除 better-sqlite3 |
| ✅ B站解析 | 纯 HTTP API（WBI 签名），移除 Playwright |
| ✅ B站扫码登录 | 纯 HTTP fetch，移除 Playwright |
| ✅ YouTube 解析 | `@distube/ytdl-core`（纯 JS），移除 yt-dlp |
| ✅ TikTok 解析 | `@distube/ytdl-core`（纯 JS），移除 yt-dlp |
| ✅ YouTube/TikTok 下载 | `ytdl` 流式下载，移除 yt-dlp |
| ✅ 抖音解析 | Browserless API（Vercel）+ 本地 Playwright 降级 |
| ✅ 移除 yt-dlp 依赖 | TikTok/YouTube 改用 ytdl-core |
| ✅ 移除 playwright 依赖（parsers 层）| 浏览器调用移到 apps/web 层 |

## 剩余问题（已知限制）

| 问题 | 原因 | 影响 |
|------|------|------|
| B站/YouTube 有声音下载 | Vercel 无 FFmpeg | 双流视频降级为仅视频（无声音） |
| 抖音需要 BROWSERLESS_TOKEN | Vercel 无本地浏览器 | 需用户自行配置（免费）|
| TikTok 需要代理 | 国内限制 | 配置 HTTP_PROXY 环境变量 |

## 架构说明

```
packages/parsers/src/
  youtube.ts    — @distube/ytdl-core 解析
  tiktok.ts     — @distube/ytdl-core 解析
  bilibili.ts   — 纯 HTTP（WBI 签名）
  douyin.ts     — 接受外部 browserFetch 注入，不含浏览器代码

apps/web/lib/
  bilibili-browser.ts  — B站 session cookie 存取 + 扫码 HTTP API
  douyin-browser.ts    — 抖音浏览器实现（Browserless/Playwright 自动切换）

apps/web/app/api/
  parse/route.ts       — 统一调度，为抖音注入 douyinBrowserFetch
  download/route.ts    — YouTube/TikTok 用 ytdl 流式下载，B站用 fetch+FFmpeg
  bilibili-login/      — 扫码登录 HTTP 实现
```

## 部署配置

Vercel 环境变量：
- `BILIBILI_COOKIE`：B站 SESSDATA（可选，扫码登录替代）
- `BROWSERLESS_TOKEN`：抖音必填，免费获取 https://browserless.io
- `HTTP_PROXY`：代理，TikTok 需要

## FFmpeg 合并问题（待解决）

Vercel 无 FFmpeg，B站 DASH 双流（视频+音频分离）和 YouTube 目前会降级为无声音。

潜在方案（未实现）：
1. **ffmpeg-wasm**：在浏览器端合并（前端内存限制大视频可能 OOM）
2. **Vercel Fluid**：Vercel 的长时间运行计算（需 Pro 计划）
3. **外部合并服务**：用 Railway/Render 跑一个合并 API
