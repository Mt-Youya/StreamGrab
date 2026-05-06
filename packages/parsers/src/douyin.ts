import type { IVideoParser, ParseOptions, VideoInfo } from "@streamgrab/types";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

interface RouterData {
  loaderData: {
    "video_(id)/page": {
      videoInfoRes: {
        item_list: Array<{
          aweme_id: string;
          desc: string;
          author: { nickname: string };
          video: {
            play_addr: { url_list: string[] };
            cover: { url_list: string[] };
            duration: number;
            width: number;
            height: number;
          };
        }>;
      };
    };
  };
}

async function resolveVideoId(url: string): Promise<string> {
  // 短链先重定向到 iesdouyin.com，从路径提取 video id
  const resp = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": UA_MOBILE },
  });
  const location = resp.headers.get("location") ?? "";
  // iesdouyin.com/share/video/{id}/ 或 douyin.com/video/{id}
  const m = location.match(/\/video\/(\d+)/);
  if (m) return m[1]!;
  // 直接从原始 URL 提取
  const m2 = url.match(/\/video\/(\d+)/);
  if (m2) return m2[1]!;
  throw new Error("无法从抖音链接提取视频 ID");
}

async function fetchVideoInfo(videoId: string): Promise<RouterData["loaderData"]["video_(id)/page"]["videoInfoRes"]["item_list"][0]> {
  const resp = await fetch(`https://www.iesdouyin.com/share/video/${videoId}/`, {
    headers: {
      "User-Agent": UA_MOBILE,
      Referer: "https://www.iesdouyin.com",
    },
  });
  const html = await resp.text();

  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{.+)/);
  if (!m) throw new Error("抖音页面结构变化，无法解析视频信息");

  const raw = m[1]!;
  let depth = 0;
  let end = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  const data: RouterData = JSON.parse(raw.slice(0, end));
  const items = data.loaderData["video_(id)/page"]?.videoInfoRes?.item_list;
  if (!items?.length) throw new Error("抖音返回的视频列表为空");
  return items[0]!;
}

export const douyinParser: IVideoParser = {
  platform: "douyin",

  match(url: string): boolean {
    return /douyin\.com/.test(url) || /v\.douyin\.com/.test(url);
  },

  async parse(url: string, _options: ParseOptions): Promise<VideoInfo> {
    console.log(`[douyin] 开始解析 url="${url}"`);

    const videoId = await resolveVideoId(url);
    console.log(`[douyin] 解析到 videoId=${videoId}`);

    const item = await fetchVideoInfo(videoId);

    const playUrls = item.video.play_addr.url_list;
    if (!playUrls.length) throw new Error("未获取到视频播放地址");

    // playwm（带水印）→ play（无水印）
    const noWatermarkUrl = playUrls[0]!.replace("/playwm/", "/play/");

    console.log(`[douyin] 解析成功 title="${item.desc.slice(0, 30)}"`);

    return {
      id: item.aweme_id,
      title: item.desc || "抖音视频",
      cover: item.video.cover.url_list[0] ?? "",
      duration: Math.floor((item.video.duration ?? 0) / 1000),
      author: item.author.nickname ?? "未知作者",
      platform: "douyin",
      streams: [
        {
          quality: "original",
          label: "原画无水印",
          url: noWatermarkUrl,
          mimeType: "video/mp4",
          width: item.video.width,
          height: item.video.height,
        },
      ],
      rawUrl: url,
    };
  },
};
