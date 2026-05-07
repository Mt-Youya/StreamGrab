# StreamGrab

多平台无水印视频下载器，支持 Bilibili、抖音、TikTok、YouTube。已支持部署到 **Vercel**。

## 功能特性

- 🎬 **多平台支持**：Bilibili、抖音、TikTok、YouTube
- 🚫 **无水印下载**：抖音使用 `play_addr` 无水印地址
- 🎯 **画质自由选择**：所有可用画质一览，锁定画质有权限提示
- 🎞️ **格式选择**：MP4、MKV、WebM（平台支持情况不同）
- 🔐 **B站扫码登录**：扫码解锁 1080P+/4K 高清画质
- 📱 **抖音自动认证**：Browserless 或本地 Playwright，无需手动配置 Cookie
- 📥 **下载队列**：实时进度显示
- 🕒 **历史记录**：localStorage 本地存储
- ☁️ **Vercel 兼容**：无需 yt-dlp / ffmpeg / 本地 Chromium

## 技术架构

```
streamgrab/
├── packages/
│   ├── types/     — 共享类型定义
│   ├── parsers/   — 各平台解析器（Bilibili/抖音/TikTok/YouTube）
│   └── core/      — 调度器
└── apps/
    └── web/       — Next.js 15 前端应用
```

## 各平台技术方案

| 平台 | 解析 | 下载 | Vercel 支持 |
|------|------|------|------------|
| **Bilibili** | 纯 HTTP API（WBI 签名）| 服务端 fetch + FFmpeg 合并（本地）/ 纯视频流（Vercel）| ✅ |
| **抖音** | Browserless API 或本地 Playwright | 服务端直接透传 | ✅（需 BROWSERLESS_TOKEN）|
| **TikTok** | `@distube/ytdl-core` | `ytdl` 流式下载 | ✅ |
| **YouTube** | `@distube/ytdl-core` | `ytdl` 流式下载 + FFmpeg（本地）| ✅ |

> ⚠️ Vercel 上没有 FFmpeg，B站和 YouTube 双流视频（视频+音频分离）无法合并，会降级为仅视频流（无声音）。本地部署可正常使用。

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+

本地部署额外可选：
- [ffmpeg](https://ffmpeg.org)（用于 B站/YouTube 音视频合并）
- Playwright Chromium（用于抖音解析）：`npx playwright install chromium`

### 安装

```bash
git clone <repo>
cd StreamGrab
pnpm install
```

### 本地配置

```bash
cp apps/web/.env.example apps/web/.env.local
```

| 变量 | 说明 |
|------|------|
| `BILIBILI_COOKIE` | B站 SESSDATA（可在设置页扫码登录替代）|
| `HTTP_PROXY` | 代理地址，如 `http://127.0.0.1:7890` |
| `BROWSERLESS_TOKEN` | 抖音解析所需（本地不需要，Vercel 需要）|

### 启动

```bash
pnpm dev
# 访问 http://localhost:3000
```

## Vercel 部署

### 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your/streamgrab)

### 环境变量配置

在 Vercel 控制台 → Settings → Environment Variables 添加：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BILIBILI_COOKIE` | 否 | B站 SESSDATA，不填最高 480P |
| `BROWSERLESS_TOKEN` | 抖音功能必填 | [免费获取](https://browserless.io)（每月 6 小时）|

### 平台限制说明

| 平台 | Vercel 状态 | 备注 |
|------|------------|------|
| Bilibili | ✅ 正常 | 未登录最高 480P，登录可解锁 1080P+ |
| 抖音 | ✅ 需配置 | 需要 BROWSERLESS_TOKEN |
| TikTok | ✅ 正常 | 需要代理（国内限制）|
| YouTube | ✅ 正常 | 双流视频无音频（Vercel 无 FFmpeg）|

## 使用说明

### 下载视频

1. 粘贴视频链接（支持 Bilibili、抖音、TikTok、YouTube）
2. 点击「解析」等待几秒
3. 选择画质和输出格式
4. 点击「下载」

### Bilibili 高清解锁

进入「设置」→「扫码登录」，用 B 站 App 扫码后可下载 1080P（普通）/ 4K（大会员）。

### 格式说明

| 格式 | 说明 |
|------|------|
| **MP4 / H.264** | 推荐，兼容 QuickTime、iOS、大多数播放器 |
| **MKV** | 保留原始编码，文件更小 |
| **WebM** | 仅 TikTok，VP9/AV1 编码（QuickTime 不支持）|

## 注意事项

- 仅供个人学习研究使用
- 请勿下载受版权保护的内容用于商业用途
- 请遵守各平台使用协议
