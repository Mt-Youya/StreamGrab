# StreamGrab

多平台无水印视频下载器，支持 Bilibili、抖音、TikTok、YouTube。

## 功能特性

- 🎬 **多平台支持**：Bilibili、抖音、TikTok、YouTube
- 🚫 **无水印下载**：抖音使用 `play_addr` 无水印地址
- 🎯 **画质自由选择**：所有可用画质一览，锁定画质有权限提示
- 🎞️ **格式选择**：MP4、MKV、WebM（平台支持情况不同）
- 🔐 **B站扫码登录**：扫码解锁 1080P+/4K 高清画质
- 📱 **自动化认证**：抖音无需配置 Cookie，全自动处理
- 📥 **下载队列**：实时进度显示
- 🕒 **历史记录**：本地 SQLite 持久化

## 技术架构

```
streamgrab/
├── packages/
│   ├── types/     — 共享类型定义
│   ├── parsers/   — 各平台解析器（Bilibili/抖音/TikTok/YouTube）
│   └── core/      — 调度器 + 下载管理
└── apps/
    └── web/       — Next.js 15 前端应用
```

## 各平台解析方案

| 平台 | 解析方式 | 说明 |
|------|---------|------|
| **Bilibili** | Playwright（stealth） + `window.__playinfo__` | 扫码登录后可下载 4K/1080P+ |
| **抖音** | Playwright 拦截 detail API 响应 | 全自动，无需 Cookie |
| **TikTok** | yt-dlp | 需要代理访问 |
| **YouTube** | yt-dlp | H.264 优先（QuickTime 兼容）|

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)（用于 TikTok/YouTube 解析下载）
- ffmpeg（用于 Bilibili 音视频合并）

### 安装

```bash
git clone <repo>
cd StreamGrab
pnpm install
npx playwright install chromium  # 安装无头浏览器
```

### 配置

```bash
cp apps/web/.env.example apps/web/.env.local
```

可配置项（均可选）：

| 变量 | 说明 |
|------|------|
| `BILIBILI_COOKIE` | B站 SESSDATA（也可在设置页扫码登录） |
| `HTTP_PROXY` | 代理地址，如 `http://127.0.0.1:7890` |
| `YTDLP_PATH` | yt-dlp 路径（默认 `yt-dlp`） |

### 启动

```bash
pnpm dev
# 访问 http://localhost:3000
```

## 使用说明

### 下载视频

1. 粘贴视频链接（支持 Bilibili、抖音、TikTok、YouTube）
2. 点击「解析」等待 10-15 秒
3. 选择画质和输出格式
4. 点击「下载」

### Bilibili 高清解锁

1. 进入「设置」页面
2. 点击「扫码登录」，用 B 站 App 扫描二维码
3. 登录成功后可下载 1080P（普通账号）或 4K/HDR（大会员）

### 格式说明

| 格式 | 说明 |
|------|------|
| **MP4 / H.264** | 推荐，兼容 QuickTime、iOS、大多数播放器 |
| **MKV** | 保留原始编码，文件更小但需专用播放器 |
| **WebM** | 仅 YouTube/TikTok，VP9/AV1 编码 |

> ⚠️ YouTube 2K 及以上画质使用 VP9 编码，macOS QuickTime 不支持，建议选 MKV 或改用 1080P。

## 注意事项

- 仅供个人学习研究使用
- 请勿下载受版权保护的内容用于商业用途
- 部分平台限制下载，请遵守平台使用协议

## 开发计划

- [ ] 改造为 Vercel 兼容版本（替换 Playwright/yt-dlp/FFmpeg 为纯 JS 方案）
- [ ] YouTube 解析器迁移至 `@distube/ytdl-core`
- [ ] 数据库迁移至 Vercel KV
- [ ] 前端直接流式下载（解决服务端超时问题）
