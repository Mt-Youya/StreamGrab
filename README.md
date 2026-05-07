# StreamGrab

多平台无水印视频下载器，支持 Bilibili、抖音、TikTok、YouTube。

**在线体验：** https://stream-grab-eight.vercel.app

## 功能特性

- 🎬 **多平台**：Bilibili、抖音、TikTok、YouTube
- 🚫 **无水印**：抖音使用 `play_addr` 无水印地址
- 🎯 **画质自由选择**：所有可用画质一览，锁定画质有权限提示
- 🎞️ **格式选择**：MP4（H.264）、MKV、WebM
- 🔐 **B站扫码登录**：解锁 1080P+/4K 高清
- 📱 **抖音自动认证**：Browserless 或本地 Playwright，无需手动配置 Cookie
- 🔊 **完整音视频**：Vercel 上使用 ffmpeg-wasm 浏览器端合并，本地使用 FFmpeg
- 🔍 **环境自检**：设置页实时显示依赖状态和安装命令
- ☁️ **Vercel 兼容**：无需 yt-dlp / 系统 ffmpeg / 本地 Chromium

## 两种部署模式

### ☁️ Vercel 模式

完全无系统依赖，所有处理在 JS 层完成。

| 平台 | 解析 | 下载 |
|------|------|------|
| Bilibili | 纯 HTTP API | 服务端下载 + 浏览器 ffmpeg-wasm 合并 |
| 抖音 | Browserless API | 直接透传 |
| TikTok | @distube/ytdl-core | ytdl 流式下载 |
| YouTube | @distube/ytdl-core | ytdl 流式 + 浏览器 ffmpeg-wasm 合并 |

所需环境变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BILIBILI_COOKIE` | 否 | 不填最高 480P，填后可解锁高清 |
| `BROWSERLESS_TOKEN` | 抖音必填 | [免费获取](https://browserless.io)（每月 6 小时）|
| `HTTP_PROXY` | TikTok 必填 | 如 `http://proxy:7890` |

### 💻 本地模式

可以利用本机 FFmpeg 和 Playwright 获得更好的体验。

| 依赖 | 用途 | 若未安装 |
|------|------|---------|
| FFmpeg | B站/YouTube 高清有声音 | 降级为浏览器 ffmpeg-wasm |
| Playwright + Chromium | 抖音解析 | 报错并提示安装命令 |

设置页「运行环境」卡片会自动检测并显示安装状态。

## 快速开始

### 安装

```bash
git clone https://github.com/Mt-Youya/StreamGrab
cd StreamGrab
pnpm install
```

### 本地启动

```bash
pnpm dev
# 访问 http://localhost:3000
```

**可选依赖（提升体验）：**

```bash
# FFmpeg — B站/YouTube 高清有声音
brew install ffmpeg  # macOS
# 或访问 https://ffmpeg.org/download.html

# Playwright Chromium — 抖音解析
pnpm --filter @streamgrab/web add playwright
npx playwright install chromium
```

不安装也可以正常使用，设置页会提示缺少的依赖。

### Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Mt-Youya/streamgrab)

部署后在 Vercel 控制台配置环境变量（见上表）。

## 架构

```
streamgrab/
├── packages/
│   ├── types/     — 共享类型
│   ├── parsers/   — 各平台解析器（纯 JS，无系统依赖）
│   └── core/      — 调度器
└── apps/
    └── web/       — Next.js 15 应用
        ├── app/api/
        │   ├── parse/        — 解析调度
        │   ├── download/     — 下载（FFmpeg 或 needsClientMerge）
        │   ├── proxy/        — 视频流代理（供浏览器 ffmpeg-wasm 用）
        │   ├── system-check/ — 环境依赖检测
        │   └── bilibili-login/ — 扫码登录
        └── lib/
            ├── douyin-browser.ts  — Browserless / 本地 Playwright 自动切换
            ├── bilibili-browser.ts — 扫码 + session 管理
            └── client-merge.ts    — 浏览器端 ffmpeg-wasm 合并
```

## 使用说明

### 下载视频

1. 粘贴视频链接
2. 点击「解析」（抖音约 10 秒，其他约 2 秒）
3. 选择画质和格式
4. 点击「下载」

B站/YouTube 双流视频（视频+音频分离）：
- **本地**：FFmpeg 在服务端自动合并
- **Vercel**：提示「浏览器合并中 XX%」，在浏览器内完成，首次需加载 ~30MB wasm 文件

### B站高清解锁

设置页 → 扫码登录 → 解锁 1080P（普通账号）/ 4K（大会员）

### 格式说明

| 格式 | 编码 | 兼容性 |
|------|------|--------|
| MP4 / H.264 | AVC | ✅ QuickTime、iOS、所有播放器 |
| MKV | 原始编码 | 需专用播放器（VLC 等）|
| WebM | VP9/AV1 | ❌ QuickTime 不支持 |

YouTube 2K 及以上无 H.264，画质标签会显示 `(vp9)` 提示。

## 注意事项

- 仅供个人学习研究使用
- 请勿下载受版权保护的内容用于商业用途
- 请遵守各平台使用协议
