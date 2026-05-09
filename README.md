# StreamGrab

多平台无水印视频下载器，支持 Bilibili、抖音、TikTok、YouTube。

**在线体验：** https://stream-grab-eight.vercel.app

## 功能特性

- 🎬 **多平台**：Bilibili、抖音、TikTok、YouTube
- 🚫 **无水印**：抖音使用 `play_addr` 无水印地址，TikTok 提取 `downloadAddr`
- 🎯 **画质自由选择**：所有可用画质一览，锁定画质有权限提示
- 🎞️ **格式选择**：MP4（H.264）、MKV、WebM
- 🔐 **B站扫码登录**：解锁 1080P+/4K 高清
- 📱 **抖音/TikTok 自动认证**：Browserless 或本地 Playwright，绕过 CF 挑战
- 🔊 **完整音视频**：Vercel 上使用 ffmpeg-wasm 浏览器端合并，本地使用 FFmpeg
- 🌐 **全链路代理**：解析 + 下载均走用户配置的 HTTP 代理，代理优先直链兜底
- ⚡ **解析缓存**：成功解析后缓存结果，同一视频再次解析 <10ms（本地 session / Vercel Upstash Redis）
- 🌙 **深色 / 浅色主题**：自动跟随系统偏好，手动一键切换
- 🔍 **环境自检**：设置页实时显示依赖状态和安装命令
- ☁️ **Vercel 兼容**：无需 yt-dlp / 系统 ffmpeg / 本地 Chromium

## 两种部署模式

### ☁️ Vercel 模式

完全无系统依赖，所有处理在 JS 层完成。

| 平台 | 解析策略 | 下载 |
|------|----------|------|
| Bilibili | 纯 HTTP API（WBI 签名）| 服务端下载 + 浏览器 ffmpeg-wasm 合并 |
| 抖音 | Browserless（代理→直连两层）| 直接透传 |
| TikTok | HTTP代理 → Browserless代理 → Browserless直连（三层）| 直链下载 |
| YouTube | youtubei.js Innertube | 直链 googlevideo + 浏览器 ffmpeg-wasm 合并 |

所需环境变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BILIBILI_COOKIE` | 否 | 不填最高 480P，填后可解锁高清 |
| `BROWSERLESS_TOKEN` | 抖音/TikTok 必填 | [免费获取](https://browserless.io)（每月 6 小时）|
| `HTTP_PROXY` | YouTube 推荐 | 如 `http://proxy:7890` |
| `UPSTASH_REDIS_REST_URL` | 缓存推荐 | Upstash Redis REST URL（Vercel Storage → Upstash）|
| `UPSTASH_REDIS_REST_TOKEN` | 缓存推荐 | Upstash Redis REST Token |

### 💻 本地模式

可以利用本机 FFmpeg 和 Playwright 获得更好的体验。

| 依赖 | 用途 | 若未安装 |
|------|------|---------|
| FFmpeg | B站/YouTube 高清有声音 | 降级为浏览器 ffmpeg-wasm |
| Playwright + Chromium | 抖音 + TikTok 解析（共用）| 报错并提示安装命令 |

- **解析缓存**：进程内 Map，session 级，重启清空（无需任何配置）
- **TikTok 本地解析**：首次 ~28s（冷启动 + CF 挑战），后续 ~6s，有缓存后 <10ms
- 设置页「运行环境」卡片会自动检测并显示安装状态

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

# Playwright Chromium — 抖音 + TikTok 解析
pnpm --filter @streamgrab/web add playwright
npx playwright install chromium
```

不安装也可以正常使用，设置页会提示缺少的依赖。

### 代理配置

设置页填写 HTTP 代理地址（如 `http://127.0.0.1:7890`），解析和下载将全程走代理（失败自动回退直链）。

### Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Mt-Youya/streamgrab)

部署后在 Vercel 控制台配置环境变量（见上表）。

**启用 Redis 缓存（可选但推荐）：**
1. Vercel Dashboard → Storage → 创建 Upstash Redis
2. 将自动生成的 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 关联到项目
3. 重新部署即可，无需改代码

## 解析缓存说明

解析成功后自动缓存 `VideoInfo`，下次相同 URL 直接返回，避免重复走耗时链路：

| 后端 | 触发条件 | TTL |
|------|----------|-----|
| 进程内 Map | 无 Redis 环境变量（本地）| session 级 |
| Upstash Redis | 配置了 `UPSTASH_REDIS_REST_URL`（Vercel 推荐）| TikTok/抖音 1h，其他 6h |
| ioredis | 配置了 `REDIS_URL`（自托管 Redis）| 同上 |

下载失败（流 URL 过期）时缓存自动清除，下次重新解析获取新地址。

## 架构

```
streamgrab/
├── packages/
│   ├── types/     — 共享类型
│   ├── parsers/   — 各平台解析器
│   │   ├── bilibili.ts    — HTTP WBI 签名
│   │   ├── douyin.ts      — 外部 browserFetch 注入
│   │   ├── tiktok.ts      — browserFetch 注入 + HTTP 层①
│   │   ├── youtube.ts     — youtubei.js + undici 代理
│   │   └── proxy-utils.ts — undici@7 通用代理工具
│   └── core/      — 调度器
└── apps/
    └── web/       — Next.js 15 应用
        ├── app/api/
        │   ├── parse/        — 缓存读写 + 三/两层兜底调度
        │   ├── download/     — FFmpeg 合并 / needsClientMerge，失败清缓存
        │   ├── proxy/        — 封面图/流代理（COEP 兼容）
        │   ├── system-check/ — 环境依赖检测
        │   └── bilibili-login/ — 扫码登录
        └── lib/
            ├── parse-cache.ts      — 解析缓存层（mem/Upstash/ioredis）
            ├── douyin-browser.ts   — Browserless/Playwright（支持代理参数）
            ├── tiktok-browser.ts   — Browserless/Playwright 持久化单例（按代理分键）
            ├── bilibili-browser.ts — 扫码 + session 管理
            └── client-merge.ts     — 浏览器端 ffmpeg-wasm 合并
```

## 使用说明

### 下载视频

1. 粘贴视频链接
2. 点击「解析」
   - Bilibili/YouTube：约 1~7 秒（有缓存 <10ms）
   - 抖音：约 10~15 秒（浏览器渲染，有缓存 <10ms）
   - TikTok：首次约 1~30 秒，有缓存后 <10ms
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
