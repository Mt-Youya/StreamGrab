import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface DouyinVideo {
  id: string;
  title: string;
  cover: string;
  duration: number;
  author: string;
  playUrls: string[];
  width?: number;
  height?: number;
}

/**
 * 用无头浏览器访问抖音视频页面，拦截浏览器自身发出的 detail API 响应。
 * 优先取 play_addr（无水印），download_addr 和 download_suffix_logo_addr 均含水印。
 */
export async function fetchDouyinVideoInfo(
  videoId: string,
  proxy?: string
): Promise<DouyinVideo> {
  console.log(`[douyin-browser] 启动 Chromium 解析 videoId=${videoId}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(proxy ? { proxy: { server: proxy } } : {}),
  });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });

    let detailBody: string | null = null;

    context.on("response", async (resp) => {
      if (detailBody) return;
      const url = resp.url();
      if (url.includes("/aweme/v1/web/aweme/detail/") && url.includes(videoId)) {
        try {
          const body = await resp.text();
          if (body.length > 100 && body.includes("aweme_detail")) {
            console.log(`[douyin-browser] 拦截到 detail API 响应 len=${body.length}`);
            detailBody = body;
          }
        } catch {
          // 响应已被消费，忽略
        }
      }
    });

    const page = await context.newPage();
    await page.goto(`https://www.douyin.com/video/${videoId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const deadline = Date.now() + 15000;
    while (!detailBody && Date.now() < deadline) {
      await page.waitForTimeout(300);
    }

    if (!detailBody) {
      throw new Error("等待抖音 API 响应超时，视频可能不存在或已被删除");
    }

    const json = JSON.parse(detailBody) as {
      status_code?: number;
      aweme_detail?: {
        aweme_id?: string;
        desc?: string;
        duration?: number;
        author?: { nickname?: string };
        video?: {
          cover?: { url_list?: string[] };
          play_addr?: { url_list?: string[] };
          play_addr_h264?: { url_list?: string[] };
          download_addr?: { url_list?: string[] };
          width?: number;
          height?: number;
        };
      };
    };

    if (!json.aweme_detail) {
      console.error("[douyin-browser] 响应中无 aweme_detail:", JSON.stringify(json).slice(0, 200));
      throw new Error(`抖音 API 错误: status_code=${json.status_code}`);
    }

    const detail = json.aweme_detail;
    const video = detail.video;

    // play_addr / play_addr_h264 均为无水印地址
    // download_addr 带抖音logo水印，download_suffix_logo_addr 带@用户名水印，均不用
    const playUrls =
      (video?.play_addr?.url_list?.length ?? 0) > 0
        ? video!.play_addr!.url_list!
        : (video?.play_addr_h264?.url_list ?? []);

    if (playUrls.length === 0) {
      throw new Error("无法获取视频播放地址");
    }

    console.log(
      `[douyin-browser] 解析成功（无水印）title="${detail.desc?.slice(0, 30)}" urls=${playUrls.length}`
    );

    return {
      id: detail.aweme_id ?? videoId,
      title: detail.desc ?? "抖音视频",
      cover: video?.cover?.url_list?.[0] ?? "",
      duration: Math.floor((detail.duration ?? 0) / 1000),
      author: detail.author?.nickname ?? "未知作者",
      playUrls,
      width: video?.width,
      height: video?.height,
    };
  } finally {
    await browser.close();
  }
}
