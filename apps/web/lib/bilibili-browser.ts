/**
 * B站登录相关工具 — 纯 HTTP 实现（Vercel 兼容）
 * Playwright 已移除，扫码登录通过 B站 passport API 完成。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Vercel 没有持久文件系统，session 存在 /tmp（每次冷启动会丢失）
const COOKIE_PATH = path.join(os.tmpdir(), "streamgrab_bilibili_cookies.json");
const COOKIE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

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

export function loadBilibiliSession(): CachedSession | null {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return null;
    const raw = fs.readFileSync(COOKIE_PATH, "utf-8");
    const session: CachedSession = JSON.parse(raw);
    if (Date.now() - session.savedAt > COOKIE_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function saveBilibiliSession(cookies: CachedSession["cookies"]) {
  try {
    const session: CachedSession = { cookies, savedAt: Date.now() };
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(session));
  } catch {}
}

export function clearBilibiliSession() {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH);
  } catch {}
}

export function isLoggedIn(): boolean {
  const session = loadBilibiliSession();
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
