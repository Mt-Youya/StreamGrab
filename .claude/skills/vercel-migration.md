---
name: vercel-migration
description: StreamGrab Vercel 改造完成状态、架构说明、代理支持、深色主题、各平台解析/下载方案、解析缓存层
---

# StreamGrab Vercel 改造（已完成）

## 完成状态

| 任务 | 方案 | 状态 |
|------|------|------|
| SQLite 历史记录 | 改为 localStorage，删除 better-sqlite3 | ✅ |
| B站解析 | 纯 HTTP API（WBI 签名），移除 Playwright | ✅ |
| B站扫码登录 | 纯 HTTP fetch，移除 Playwright | ✅ |
| YouTube 解析 | `youtubei.js` Innertube（纯 JS），支持代理 | ✅ |
| TikTok 解析 | 三层兜底：HTTP代理 → 浏览器代理 → 浏览器直连 | ✅ |
| YouTube 下载 | 直链 googlevideo + undici 代理下载 + FFmpeg 合并 | ✅ |
| TikTok 下载 | undici 直链/代理下载 | ✅ |
| 抖音解析 | 两层兜底：浏览器代理 → 浏览器直连 | ✅ |
| B站/YouTube 无声音（Vercel）| `@ffmpeg/ffmpeg` 浏览器端 wasm 合并 | ✅ |
| 环境依赖检测 | `/api/system-check` + 设置页「运行环境」卡片 | ✅ |
| 代理支持（全平台）| parse + download 全链路，代理优先直链兜底 | ✅ |
| B站封面 COEP 兼容 | `/api/proxy` 返回 `Cross-Origin-Resource-Policy: cross-origin` | ✅ |
| 深色 / 浅色主题 | ThemeProvider + localStorage + 防闪烁内联 script | ✅ |
| **解析结果缓存** | **进程内 Map（本地）/ Upstash Redis / ioredis（Vercel）** | ✅ |

## 各平台解析策略

### TikTok（三层兜底）
1. **层①（最快）**：undici HTTP 代理直接爬取页面 HTML，提取 `__UNIVERSAL_DATA_FOR_REHYDRATION__`，无需启动浏览器，约 1-2s
2. **层②**：Playwright/Browserless 走代理，等待 CF 挑战通过
3. **层③**：Playwright/Browserless 直连（无代理兜底）

本地 Playwright 使用**按代理分键的持久化 context 单例**（`Map<string, BrowserContext>`），复用后 ~6s。

### 抖音（两层兜底）
1. **层①**：Playwright/Browserless 走代理
2. **层②**：Playwright/Browserless 直连

### YouTube / B站（代理→直链）
通用逻辑：有代理先试代理，失败自动回退直链。

## 解析结果缓存层

文件：`apps/web/lib/parse-cache.ts`

### 后端选择（自动检测）
| 环境变量 | 后端 | 说明 |
|---------|------|------|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis | HTTP，Serverless 友好，推荐 |
| `REDIS_URL` | ioredis | TCP，传统 Redis |
| 无 | 进程内 `Map` | session 级，重启清空（本地开发） |

### TTL 策略
- TikTok / 抖音：**1h**（流 URL 较短命）
- B站 / YouTube：**6h**

### Key 格式
```
streamgrab:parse:{platform}:{videoId}
```
- videoId 从 URL 提取（bilibili=BVid, youtube/tiktok/douyin=数字 ID）

### 缓存失效
- TTL 自动过期
- 下载失败（4xx/5xx）时 `deleteCached()` 主动清除 → 下次强制重新解析

### 效果
| 平台 | 首次（miss）| 命中（hit）|
|------|-------------|------------|
| B站 | ~300ms | **<5ms** |
| TikTok（层①）| ~1200ms | **<10ms** |
| YouTube | ~5s | **<10ms** |

## 两种运行模式

### 本地模式（无 `VERCEL` 环境变量）

| 功能 | 依赖 | 说明 |
|------|------|------|
| B站解析 | 无 | 纯 HTTP |
| B站高清下载 | **FFmpeg**（可选）| 有则合并有声音，无则降级 ffmpeg-wasm |
| 抖音解析 | **Playwright + Chromium**（可选）| 有则本地运行，无则报错提示安装 |
| TikTok 解析 | **Playwright + Chromium**（可选）| 持久化 context，首次 ~28s，后续 ~6s，有缓存后 <10ms |
| YouTube | 无（FFmpeg 可选）| youtubei.js 解析 |
| 缓存 | 进程内 Map | session 级，重启清空 |

### Vercel 模式（存在 `VERCEL` 环境变量）

| 功能 | 方案 |
|------|------|
| B站高清下载 | 服务端无 FFmpeg → 返回 `needsClientMerge:true` → 前端 ffmpeg-wasm |
| 抖音解析 | Browserless HTTP API（需 `BROWSERLESS_TOKEN`）|
| TikTok 解析 | 层① HTTP代理 → 层② Browserless代理 → 层③ Browserless直连 |
| YouTube | youtubei.js + 直链下载 + ffmpeg-wasm 合并 |
| 缓存 | Upstash Redis（需配置环境变量）或进程内 Map 降级 |

## 代理支持架构

- **来源**：请求体 `proxy` 字段（用户设置页）→ 环境变量 `HTTP_PROXY` / `http_proxy`
- **策略**：代理优先，直链兜底（抖音/TikTok 除外，它们有独立多层策略）
- **机制**：undici@7 ProxyAgent，自动处理 CONNECT 隧道和 MITM 代理
- **视频流**：不设 `Accept-Encoding`，视频是二进制格式
- **YouTube parse**：undici@5 ProxyAgent 注入 youtubei.js（与其内部版本兼容）

## 关键架构文件

```
packages/parsers/src/
  youtube.ts      — youtubei.js + undici@5 ProxyAgent，代理→直链兜底
  tiktok.ts       — browserFetch 注入 + tiktokHttpFetch（HTTP 层①）
  bilibili.ts     — 纯 HTTP WBI 签名
  douyin.ts       — 外部 browserFetch 注入
  proxy-utils.ts  — undici@7 通用代理工具（proxyRequest / proxyDownloadStream）

apps/web/lib/
  parse-cache.ts       — 解析结果缓存（mem / Upstash / ioredis 自动切换）
  bilibili-browser.ts  — B站扫码 HTTP API
  douyin-browser.ts    — 抖音 Browserless / Playwright（支持代理参数）
  tiktok-browser.ts    — TikTok Browserless / Playwright 持久化单例（按代理分键）
  client-merge.ts      — 浏览器端 ffmpeg-wasm 合并

apps/web/app/api/
  parse/route.ts        — 缓存读写 + TikTok 三层 / 抖音两层 / 其他代理→直链
  download/route.ts     — 下载失败时 deleteCached()，downloadWithFallback 代理→直链
  proxy/route.ts        — 封面图/流代理（COEP）
  system-check/route.ts — 检测 FFmpeg/Playwright/Browserless（含 TikTok）
  bilibili-login/       — 扫码登录

apps/web/components/
  theme-provider.tsx   — ThemeProvider + useTheme()
  navigation.tsx       — Sun/Moon 切换按钮
  download-form.tsx    — 平台感知等待提示（TikTok ~30s 提醒）
  video-preview.tsx    — 封面走代理路由
  quality-selector.tsx — 发送 mimeType 给 download API
```

## Vercel 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BILIBILI_COOKIE` | 否 | B站 SESSDATA，不填最高 480P |
| `BROWSERLESS_TOKEN` | 抖音/TikTok 必填 | 免费获取：https://browserless.io（每月 6 小时）|
| `HTTP_PROXY` | YouTube 推荐 | 如 `http://proxy:7890` |
| `UPSTASH_REDIS_REST_URL` | 缓存推荐 | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 缓存推荐 | Upstash Redis REST Token |

## next.config.ts 关键配置

```ts
serverExternalPackages: ["playwright", "@distube/ytdl-core", "youtubei.js", "undici", "@upstash/redis", "ioredis"]
headers: COOP + COEP  // SharedArrayBuffer for ffmpeg-wasm
// 注：postcss.config.mjs 已删除，Turbopack 原生处理 Tailwind v4
// build 命令：next build（Turbopack，推荐）
```

## 已知问题与 Workaround

| 问题 | 原因 | 解决 |
|------|------|------|
| TikTok 首次解析 ~28s | CF 挑战 + 浏览器冷启动 | 持久化 context + 缓存，后续 <10ms |
| TikTok 层① CF 拦截 | 代理 IP 被标记 | 自动降级层②浏览器代理 |
| 视频下载 FFmpeg "header parsing failed" | 代理带 Accept-Encoding | 视频流不设 Accept-Encoding |
| FFmpeg "moov atom not found" | VP9 流存成 .mp4 | mimeType 决定 .video.webm/.video.mp4 |
| B站封面 COEP 跨域 | proxy route 缺 CORP header | `Cross-Origin-Resource-Policy: cross-origin` |
| YouTube undici 版本冲突 | youtubei.js 用 undici@5 | YouTube parse 用 undici@5 ProxyAgent |
| Turbopack 可选包警告 | 静态分析 require() 字符串 | 包名用 `join(String.fromCharCode(47))` 构造 |
