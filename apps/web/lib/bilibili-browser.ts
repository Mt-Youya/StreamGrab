/**
 * B站登录相关工具 — 纯 HTTP 实现（Vercel 兼容）
 * Playwright 已移除，扫码登录通过 B站 passport API 完成。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const COOKIE_PATH = path.join(os.tmpdir(), "streamgrab_bilibili_cookies.json");
const REDIS_KEY = "streamgrab:bilibili:session";

interface CachedSession {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  savedAt: number;
}

// ── Redis 客户端（复用 parse-cache 的逻辑）─────────────────
function makeRedisClient() {
  if (process.env["UPSTASH_REDIS_REST_URL"] && process.env["UPSTASH_REDIS_REST_TOKEN"]) {
    try {
      const pkgName = ["@upstash", "redis"].join(String.fromCharCode(47));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Redis } = require(/* webpackIgnore: true */ pkgName);
      return { type: "upstash" as const, client: new Redis() };
    } catch {}
  }
  if (process.env["REDIS_URL"]) {
    try {
      const pkgName = ["io", "redis"].join("");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require(/* webpackIgnore: true */ pkgName);
      return { type: "ioredis" as const, client: new Redis(process.env["REDIS_URL"]) };
    } catch {}
  }
  return null;
}

const _redis = makeRedisClient();

async function redisGet(): Promise<CachedSession | null> {
  if (!_redis) return null;
  try {
    if (_redis.type === "upstash") return (await _redis.client.get(REDIS_KEY)) as CachedSession | null;
    const raw = await _redis.client.get(REDIS_KEY);
    return raw ? (JSON.parse(raw) as CachedSession) : null;
  } catch {
    return null;
  }
}

async function redisSet(session: CachedSession): Promise<void> {
  if (!_redis) return;
  try {
    // TTL 180 天，B站 Cookie 有效期通常半年
    if (_redis.type === "upstash") await _redis.client.set(REDIS_KEY, session, { ex: 180 * 24 * 3600 });
    else await _redis.client.set(REDIS_KEY, JSON.stringify(session), "EX", 180 * 24 * 3600);
  } catch {}
}

async function redisDel(): Promise<void> {
  if (!_redis) return;
  try {
    await _redis.client.del(REDIS_KEY);
  } catch {}
}

// ── 文件读写（本地 /tmp 二级缓存）────────────────────────────
function fileLoad(): CachedSession | null {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return null;
    return JSON.parse(fs.readFileSync(COOKIE_PATH, "utf-8")) as CachedSession;
  } catch {
    return null;
  }
}

function fileSave(session: CachedSession) {
  try {
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(session));
  } catch {}
}

function fileDel() {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH);
  } catch {}
}

// ── 公开 API ─────────────────────────────────────────────────

export async function loadBilibiliSessionAsync(): Promise<CachedSession | null> {
  // 优先读 /tmp 内存缓存（快），没有再查 Redis
  const cached = fileLoad();
  if (cached) return cached;
  const session = await redisGet();
  if (session) fileSave(session); // 回写 /tmp 加速后续同容器请求
  return session;
}

/** 同步版本：仅读 /tmp，供不支持 async 的调用方 */
export function loadBilibiliSession(): CachedSession | null {
  return fileLoad();
}

export async function saveBilibiliSession(cookies: CachedSession["cookies"]) {
  const session: CachedSession = { cookies, savedAt: Date.now() };
  fileSave(session);
  await redisSet(session);
}

export async function clearBilibiliSession() {
  fileDel();
  await redisDel();
}

export async function isLoggedIn(): Promise<boolean> {
  const session = await loadBilibiliSessionAsync();
  if (!session) return false;
  return session.cookies.some((c) => c.name === "SESSDATA" && c.value.length > 10);
}

/** 生成二维码 */
export async function generateQrcode(): Promise<{ url: string; qrcode_key: string }> {
  const resp = await fetch("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com" },
  });
  const json = (await resp.json()) as { code: number; data?: { url: string; qrcode_key: string } };
  if (json.code !== 0 || !json.data) throw new Error("生成二维码失败");
  return json.data;
}

/** 轮询扫码状态，confirmed 时返回 cookie 字符串 */
export async function pollQrcodeStatus(
  qrcode_key: string
): Promise<{ status: "waiting" | "scanned" | "confirmed" | "expired"; cookieStr?: string }> {
  const resp = await fetch(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`, {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com" },
  });

  // 从 Set-Cookie 头提取 cookie
  const rawSetCookie = resp.headers.get("set-cookie") ?? "";
  const innerCode = ((await resp.json()) as { data?: { code?: number } }).data?.code;

  if (innerCode === 0) {
    // 从 Set-Cookie 解析出各字段
    const cookieEntries = rawSetCookie.split(",").map((c) => c.split(";")[0].trim());
    return { status: "confirmed", cookieStr: cookieEntries.join("; ") };
  }
  if (innerCode === 86090) return { status: "scanned" };
  if (innerCode === 86038) return { status: "expired" };
  return { status: "waiting" };
}

// 导出类型兼容（旧代码引用）
export type { CachedSession };
