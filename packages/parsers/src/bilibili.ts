import type { IVideoParser, ParseOptions, VideoInfo, VideoStream } from "@streamgrab/types";

const BV_REGEX = /BV[a-zA-Z0-9]{10}/;
const BILIBILI_API = "https://api.bilibili.com";

interface WbiKeys {
  imgKey: string;
  subKey: string;
}

const MIX_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
  54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

function getMixinKey(orig: string): string {
  return MIX_KEY_ENC_TAB.slice(0, 32)
    .map((n) => orig[n] ?? "")
    .join("");
}

async function getWbiKeys(cookie: string): Promise<WbiKeys> {
  const resp = await fetch(`${BILIBILI_API}/x/web-interface/nav`, {
    headers: {
      Cookie: cookie,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com",
    },
  });
  const json = (await resp.json()) as {
    data?: { wbi_img?: { img_url?: string; sub_url?: string } };
  };
  const imgUrl = json.data?.wbi_img?.img_url ?? "";
  const subUrl = json.data?.wbi_img?.sub_url ?? "";
  return {
    imgKey: imgUrl.split("/").pop()?.replace(".png", "") ?? "",
    subKey: subUrl.split("/").pop()?.replace(".png", "") ?? "",
  };
}

async function signWbi(params: Record<string, string | number>, keys: WbiKeys): Promise<string> {
  const mixinKey = getMixinKey(keys.imgKey + keys.subKey);
  const wts = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams({ ...params, wts: wts.toString() } as Record<string, string>);
  const sorted = Array.from(query.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v.replace(/[!'()*]/g, "")}`)
    .join("&");
  const wRid = await md5(sorted + mixinKey);
  return `${sorted}&w_rid=${wRid}&wts=${wts}`;
}

async function md5(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("MD5", data).catch(() => null);
  if (hashBuffer) {
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback: simple hash (for environments without crypto.subtle MD5)
  let hash = 0;
  for (const char of text) {
    hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(32, "0");
}

function formatDuration(seconds: number): number {
  return Math.floor(seconds);
}

function mapQuality(qn: number): { quality: string; label: string } {
  const map: Record<number, { quality: string; label: string }> = {
    127: { quality: "8K", label: "8K 超高清" },
    126: { quality: "dolby", label: "杜比视界" },
    125: { quality: "hdr", label: "HDR 真彩" },
    120: { quality: "4K", label: "4K 超清" },
    116: { quality: "1080P+", label: "1080P 高帧率" },
    112: { quality: "1080P+", label: "1080P 高清+" },
    80: { quality: "1080P", label: "1080P 高清" },
    74: { quality: "720P+", label: "720P 高帧率" },
    64: { quality: "720P", label: "720P 高清" },
    48: { quality: "480P", label: "480P 清晰" },
    32: { quality: "360P", label: "360P 流畅" },
    16: { quality: "360P", label: "360P 极速" },
  };
  return map[qn] ?? { quality: `${qn}P`, label: `${qn}P` };
}

export const bilibiliParser: IVideoParser = {
  platform: "bilibili",

  match(url: string): boolean {
    return /bilibili\.com\/(video|bangumi)/.test(url) || BV_REGEX.test(url);
  },

  async parse(url: string, options: ParseOptions): Promise<VideoInfo> {
    const bvMatch = url.match(BV_REGEX);
    if (!bvMatch) {
      throw new Error("无法从 URL 提取 BV 号");
    }
    const bvid = bvMatch[0];
    const cookie = options.cookie ?? "";

    console.log(`[bilibili] 开始解析 bvid=${bvid} hasCookie=${!!cookie}`);

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com",
    };
    if (cookie) headers["Cookie"] = cookie;

    console.log(`[bilibili] 请求视频信息 /x/web-interface/view?bvid=${bvid}`);
    const viewResp = await fetch(`${BILIBILI_API}/x/web-interface/view?bvid=${bvid}`, { headers });
    console.log(`[bilibili] view API 响应状态: ${viewResp.status}`);
    const viewJson = (await viewResp.json()) as {
      code?: number;
      data?: {
        cid?: number;
        title?: string;
        pic?: string;
        duration?: number;
        owner?: { name?: string };
        bvid?: string;
      };
    };

    console.log(`[bilibili] view API code=${viewJson.code}`);
    if (viewJson.code !== 0 || !viewJson.data) {
      console.error(`[bilibili] view API 失败: code=${viewJson.code}，完整响应:`, JSON.stringify(viewJson).slice(0, 300));
      throw new Error(`Bilibili API 错误: ${viewJson.code}`);
    }

    const { cid, title, pic, duration, owner } = viewJson.data;
    console.log(`[bilibili] 视频信息: title="${title}" cid=${cid}`);
    if (!cid) throw new Error("无法获取视频 cid");

    let playUrl: string;
    if (cookie) {
      console.log("[bilibili] 有 cookie，尝试获取 WBI 签名");
      const wbiKeys = await getWbiKeys(cookie).catch((e) => {
        console.warn("[bilibili] 获取 WBI keys 失败:", e);
        return null;
      });
      if (wbiKeys) {
        console.log(`[bilibili] WBI keys: imgKey=${wbiKeys.imgKey.slice(0, 8)}...`);
        const signedQuery = await signWbi({ bvid, cid, fnval: 16, fourk: 1 }, wbiKeys);
        playUrl = `${BILIBILI_API}/x/player/wbi/playurl?${signedQuery}`;
        console.log("[bilibili] 使用 WBI 签名播放地址");
      } else {
        playUrl = `${BILIBILI_API}/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`;
        console.log("[bilibili] WBI 失败，降级使用普通播放地址");
      }
    } else {
      playUrl = `${BILIBILI_API}/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`;
      console.log("[bilibili] 无 cookie，使用普通播放地址（画质可能受限）");
    }

    console.log(`[bilibili] 请求播放地址`);
    const playResp = await fetch(playUrl, { headers });
    console.log(`[bilibili] playurl API 响应状态: ${playResp.status}`);
    const playJson = (await playResp.json()) as {
      code?: number;
      data?: {
        dash?: {
          video?: Array<{ id: number; baseUrl: string; bandwidth: number; width: number; height: number; mimeType: string }>;
          audio?: Array<{ id: number; baseUrl: string; bandwidth: number; mimeType: string }>;
        };
        durl?: Array<{ url: string; size: number }>;
        accept_quality?: number[];
        quality?: number;
      };
    };

    console.log(`[bilibili] playurl API code=${playJson.code}`);
    if (playJson.code !== 0 || !playJson.data) {
      console.error(`[bilibili] playurl API 失败: code=${playJson.code}，完整响应:`, JSON.stringify(playJson).slice(0, 300));
      throw new Error(`Bilibili 播放地址获取失败: ${playJson.code}`);
    }

    const streams: VideoStream[] = [];
    const { dash, durl, accept_quality } = playJson.data;
    console.log(`[bilibili] 响应格式: dash=${!!dash} durl=${!!durl} dash.video数量=${dash?.video?.length ?? 0} accept_quality=${accept_quality?.join(",")}`);

    if (dash?.video && dash.audio) {
      const bestAudio = dash.audio.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
      const seenQn = new Set<number>();
      for (const v of dash.video) {
        if (seenQn.has(v.id)) continue;
        seenQn.add(v.id);
        const { quality, label } = mapQuality(v.id);
        streams.push({
          quality,
          label,
          url: v.baseUrl,
          mimeType: v.mimeType ?? "video/mp4",
          width: v.width,
          height: v.height,
          bitrate: v.bandwidth,
          audioUrl: bestAudio.baseUrl,
        });
      }

      // 将 accept_quality 中未解锁的画质也追加，让用户知道有哪些更高画质需要登录/大会员
      if (accept_quality) {
        for (const qn of accept_quality) {
          if (seenQn.has(qn)) continue; // 已解锁，跳过
          const { quality, label } = mapQuality(qn);
          const needVip = qn >= 112; // 112+ 需要大会员
          const lockReason = needVip
            ? "需要大会员，请在设置中填入 SESSDATA Cookie"
            : "需要登录，请在设置中填入 SESSDATA Cookie";
          streams.push({
            quality,
            label,
            url: "",
            mimeType: "video/mp4",
            locked: true,
            lockReason,
          });
        }
      }
    } else if (durl?.length) {
      streams.push({
        quality: "default",
        label: "标准画质",
        url: durl[0]!.url,
        mimeType: "video/mp4",
        size: durl[0]!.size,
      });
    }

    console.log(`[bilibili] 解析完成，streams=${streams.length}`);
    if (streams.length === 0) {
      console.warn("[bilibili] 未获取到任何视频流，dash.video:", JSON.stringify(dash?.video?.slice(0, 2)));
    }
    return {
      id: bvid,
      title: title ?? "未知标题",
      cover: pic ?? "",
      duration: formatDuration(duration ?? 0),
      author: owner?.name ?? "未知UP主",
      platform: "bilibili",
      streams,
      rawUrl: url,
    };
  },
};
