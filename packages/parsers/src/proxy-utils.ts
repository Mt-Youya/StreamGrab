/**
 * HTTP 代理工具 —— 基于 undici ProxyAgent
 *
 * undici 是 Node.js 18+ 内置的 HTTP 客户端，其 ProxyAgent 原生支持：
 *   - HTTP/HTTPS 代理
 *   - CONNECT 隧道（标准透明代理）
 *   - MITM 代理（如 Clash TUN、Charles、mitmproxy）
 * 无需手动处理 CONNECT / TLS，兼容性最好。
 */
import { ProxyAgent, fetch as undiciFetch, type RequestInfo, type RequestInit } from "undici";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import fs from "node:fs";

export interface ProxyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  /** 超时毫秒，默认 20000 */
  timeout?: number;
}

/**
 * 通过 HTTP 代理发请求，返回 { status, headers, buffer }。
 * 使用 undici ProxyAgent，自动处理 CONNECT 隧道和 MITM 代理。
 */
export async function proxyRequest(
  targetUrl: string,
  proxy: string | undefined,
  opts: ProxyRequestOptions = {}
): Promise<{ status: number; headers: Record<string, string>; buffer: Buffer }> {
  const { method = "GET", headers = {}, body, timeout = 20000 } = opts;

  // "direct://" 或 undefined 表示不使用代理
  const isDirect = !proxy || proxy === "direct://";
  const agent = isDirect
    ? undefined
    : new ProxyAgent({
        uri: proxy,
        requestTls: { rejectUnauthorized: false },
        proxyTls: { rejectUnauthorized: false },
        connectTimeout: timeout,
      });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await undiciFetch(
      targetUrl as RequestInfo,
      {
        method,
        headers: {
          "Accept-Encoding": "gzip, deflate, br",
          ...headers,
        },
        body: body ?? null,
        dispatcher: agent,
        signal: controller.signal,
      } as RequestInit
    );

    const buf = Buffer.from(await res.arrayBuffer());
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return { status: res.status, headers: respHeaders, buffer: buf };
  } finally {
    clearTimeout(timer);
    if (agent) await agent.close().catch(() => {});
  }
}

/**
 * 通过 HTTP 代理流式下载（写入 WriteStream），支持进度回调。
 * 使用 undici ProxyAgent，自动处理 CONNECT / MITM，视频流不加 Accept-Encoding。
 */
export async function proxyDownloadStream(
  targetUrl: string,
  proxy: string,
  headers: Record<string, string>,
  onData: (chunk: Buffer, total: number) => void,
  timeout = 120000
): Promise<void> {
  const agent = new ProxyAgent({
    uri: proxy,
    requestTls: { rejectUnauthorized: false },
    proxyTls: { rejectUnauthorized: false },
    connectTimeout: 20000,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await undiciFetch(
      targetUrl as RequestInfo,
      {
        method: "GET",
        // 视频/音频流不加 Accept-Encoding，透传原始字节
        headers,
        dispatcher: agent,
        signal: controller.signal,
      } as RequestInit
    );

    if (!res.ok || !res.body) {
      throw new Error(`下载失败 ${res.status} ${res.statusText}`);
    }

    const total = Number(res.headers.get("content-length") ?? 0);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onData(Buffer.from(value), total);
    }
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => {});
  }
}

/**
 * 构造走代理的 fetch 函数（供 youtubei.js 等库注入）。
 * 使用 undici ProxyAgent，自动处理 CONNECT / MITM。
 */
export function makeProxyFetch(proxy: string): typeof fetch {
  return async (input: globalThis.RequestInfo | URL, init?: globalThis.RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    const method = (init?.method ??
      (typeof input !== "string" && !(input instanceof URL) ? (input as Request).method : "GET")) as string;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (typeof (init.headers as { entries?: unknown }).entries === "function") {
        for (const [k, v] of (init.headers as Headers).entries()) headers[k] = v;
      } else {
        const h = init.headers as Record<string, string>;
        for (const k of Object.keys(h)) headers[k] = h[k];
      }
    }
    const body = init?.body != null ? init.body : null;

    // 每次请求新建 agent，避免连接复用导致的连接池问题
    const agent = new ProxyAgent({
      uri: proxy,
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
      connectTimeout: 15000,
    });

    try {
      const res = await undiciFetch(
        url as RequestInfo,
        {
          method,
          headers: {
            "Accept-Encoding": "gzip, deflate, br",
            ...headers,
          },
          body: body as RequestInit["body"],
          dispatcher: agent,
        } as RequestInit
      );

      const buf = await res.arrayBuffer();
      const resHeaders = new Headers();
      res.headers.forEach((v, k) => resHeaders.set(k, v));
      return new Response(buf, { status: res.status, headers: resHeaders });
    } finally {
      await agent.close().catch(() => {});
    }
  };
}
