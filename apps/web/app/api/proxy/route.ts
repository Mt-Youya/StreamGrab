import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = [
  "bilivideo.com", "bilivideo.cn", "hdslb.com",
  "douyinvod.com", "douyinpic.com",
  "tiktokcdn.com", "tiktokv.com",
  "googlevideo.com",
];

function isAllowed(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.some((h) => hostname.endsWith(h));
  } catch {
    return false;
  }
}

const REFERERS: Record<string, string> = {
  bilivideo: "https://www.bilibili.com",
  douyinvod: "https://www.douyin.com",
  tiktok: "https://www.tiktok.com",
  googlevideo: "https://www.youtube.com",
};

function getReferer(url: string): string {
  for (const [key, referer] of Object.entries(REFERERS)) {
    if (url.includes(key)) return referer;
  }
  return "";
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }
  if (!isAllowed(target)) {
    return NextResponse.json({ error: "不允许代理该域名" }, { status: 403 });
  }

  const referer = getReferer(target);
  const upstream = await fetch(target, {
    headers: {
      "User-Agent": UA,
      ...(referer ? { Referer: referer } : {}),
    },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `上游请求失败: ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = upstream.headers.get("content-length");

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
  });
}
