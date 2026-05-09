import type { IVideoParser, ParseOptions, VideoInfo } from "@streamgrab/types";

/**
 * 抖音解析器
 *
 * 本身不含浏览器逻辑，通过 options.browserFetch 接收外部浏览器调用结果。
 * - 本地部署：由 apps/web/lib/douyin-browser.ts 提供 Playwright 实现
 * - Vercel：由 apps/web/lib/douyin-browser.ts 提供 Browserless 实现
 *
 * 若 options.browserFetch 未提供，解析器直接报错提示配置方式。
 */

export interface DouyinParseOptions extends ParseOptions {
  /** 外部传入的浏览器抓取函数，返回 aweme/detail API 的 JSON 响应体 */
  browserFetch?: (videoId: string) => Promise<string>;
}

export const douyinParser: IVideoParser = {
  platform: "douyin",

  match(url: string): boolean {
    return /douyin\.com/.test(url) || /v\.douyin\.com/.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const opts = options as DouyinParseOptions;
    console.log(`[douyin] 开始解析 url="${url}"`);

    // 处理短链
    let resolvedUrl = url;
    if (/v\.douyin\.com/.test(url)) {
      const r = await fetch(url, { method: "HEAD", redirect: "manual" }).catch(() => null);
      const loc = r?.headers.get("location");
      if (loc) resolvedUrl = loc;
    }

    const videoIdMatch = resolvedUrl.match(/video\/(\d+)/);
    if (!videoIdMatch) throw new Error("无法从抖音 URL 提取视频 ID");
    const videoId = videoIdMatch[1];

    if (!opts.browserFetch) {
      throw new Error(
        "抖音解析需要浏览器支持。\n" +
          "• Vercel 部署：在 Vercel 控制台添加环境变量 BROWSERLESS_TOKEN（免费获取：https://browserless.io）\n" +
          "• 本地部署：已自动支持，无需额外配置"
      );
    }

    const rawBody = await opts.browserFetch(videoId);
    const json = JSON.parse(rawBody) as {
      aweme_detail?: {
        aweme_id?: string;
        desc?: string;
        duration?: number;
        author?: { nickname?: string };
        video?: {
          cover?: { url_list?: string[] };
          play_addr?: { url_list?: string[] };
          play_addr_h264?: { url_list?: string[] };
          width?: number;
          height?: number;
        };
      };
    };

    if (!json.aweme_detail) throw new Error("抖音 API 未返回视频数据");
    const d = json.aweme_detail;
    const video = d.video;

    const playUrls =
      (video?.play_addr?.url_list?.length ?? 0) > 0
        ? video!.play_addr!.url_list!
        : (video?.play_addr_h264?.url_list ?? []);

    if (playUrls.length === 0) throw new Error("无法获取视频播放地址");

    console.log(`[douyin] 解析成功 title="${(d.desc ?? "").slice(0, 30)}" urls=${playUrls.length}`);

    return {
      id: d.aweme_id ?? videoId,
      title: d.desc ?? "抖音视频",
      cover: video?.cover?.url_list?.[0] ?? "",
      duration: Math.floor((d.duration ?? 0) / 1000),
      author: d.author?.nickname ?? "未知作者",
      platform: "douyin",
      streams: playUrls.slice(0, 3).map((u, i) => ({
        quality: i === 0 ? "original" : `original_${i}`,
        label: i === 0 ? "原画无水印" : `备用线路 ${i}`,
        url: u,
        mimeType: "video/mp4",
        width: video?.width,
        height: video?.height,
      })),
      rawUrl: url,
    };
  },
};
