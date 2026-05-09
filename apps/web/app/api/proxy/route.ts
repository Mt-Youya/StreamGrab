import { NextRequest, NextResponse } from "next/server";
import { proxyRequest } from "@streamgrab/parsers";

const ALLOWED_HOSTS = [
  "bilivideo.com",
  "bilivideo.cn",
  "hdslb.com",
  "douyinvod.com",
  "douyinpic.com",
  "douyinstatic.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "googlevideo.com",
  "ytimg.com",
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
  hdslb: "https://www.bilibili.com",
  douyinvod: "https://www.douyin.com",
  douyinpic: "https://www.douyin.com",
  douyinstatic: "https://www.douyin.com",
  tiktok: "https://www.tiktok.com",
  googlevideo: "https://www.youtube.com",
  ytimg: "https://www.youtube.com",
};

function getReferer(url: string): string {
  for (const [key, referer] of Object.entries(REFERERS)) {
    if (url.includes(key)) return referer;
  }
  return "";
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }
  if (!isAllowed(target)) {
    return NextResponse.json({ error: "不允许代理该域名" }, { status: 403 });
  }

  const referer = getReferer(target);
  const reqHeaders: Record<string, string> = {
    "User-Agent": UA,
    ...(referer ? { Referer: referer } : {}),
  };

  const httpProxy = req.nextUrl.searchParams.get("proxy") || process.env["HTTP_PROXY"] || process.env["http_proxy"];

  try {
    if (httpProxy) {
      // 走代理：CONNECT 隧道（正确处理 HTTPS）
      const { status, headers, buffer } = await proxyRequest(target, httpProxy, {
        headers: reqHeaders,
        timeout: 10000,
      });
      if (status < 200 || status >= 300) {
        return NextResponse.json({ error: `上游请求失败: ${status}` }, { status });
      }
      const contentType = headers["content-type"] ?? "application/octet-stream";
      const contentLength = headers["content-length"];
      return new NextResponse(new Uint8Array(buffer), {
        status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
          ...(contentLength ? { "Content-Length": contentLength } : {}),
        },
      });
    }

    const upstream = await fetch(target, { headers: reqHeaders });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `上游请求失败: ${upstream.status}` }, { status: upstream.status });
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
