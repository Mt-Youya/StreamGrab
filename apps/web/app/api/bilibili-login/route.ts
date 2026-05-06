import { NextRequest, NextResponse } from "next/server";
import {
  generateQrcode,
  pollQrcode,
  clearBilibiliSession,
  isLoggedIn,
  loadBilibiliSession,
} from "@/lib/bilibili-browser";
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GET /api/bilibili-login?action=status — 查询当前登录状态
// POST /api/bilibili-login  { action: "generate" } — 生成二维码
// POST /api/bilibili-login  { action: "poll", qrcode_key } — 轮询扫码状态
// POST /api/bilibili-login  { action: "logout" } — 清除 session

export async function GET() {
  const loggedIn = isLoggedIn();
  const session = loadBilibiliSession();
  const sessdata = session?.cookies.find((c) => c.name === "SESSDATA");
  return NextResponse.json({
    loggedIn,
    savedAt: session?.savedAt,
    sessdataHint: sessdata
      ? sessdata.value.slice(0, 8) + "..."
      : null,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    qrcode_key?: string;
  };

  if (body.action === "generate") {
    const data = await generateQrcode();
    return NextResponse.json({ success: true, ...data });
  }

  if (body.action === "poll") {
    const { qrcode_key } = body;
    if (!qrcode_key) {
      return NextResponse.json({ success: false, error: "缺少 qrcode_key" }, { status: 400 });
    }

    // 用 Playwright 轮询，这样可以同时捕获登录 cookie
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext({ userAgent: UA });
      const page = await context.newPage();
      await page.goto("https://www.bilibili.com", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      const pollResp = await page.evaluate(async (key: string) => {
        const r = await fetch(
          `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${key}`,
          { credentials: "include" }
        );
        return r.json();
      }, qrcode_key);

      const innerCode = (pollResp as { data?: { code?: number } }).data?.code;

      if (innerCode === 0) {
        // 登录成功
        const cookies = await context.cookies("https://www.bilibili.com");
        const hasSESSDATA = cookies.some((c) => c.name === "SESSDATA" && c.value.length > 10);
        if (hasSESSDATA) {
          const { saveBilibiliSession } = await import("@/lib/bilibili-browser");
          saveBilibiliSession(cookies);
          await browser.close();
          return NextResponse.json({ success: true, status: "confirmed" });
        }
      }

      await browser.close();
      const status =
        innerCode === 86090 ? "scanned"
        : innerCode === 86038 ? "expired"
        : "waiting";
      return NextResponse.json({ success: true, status });
    } catch (err) {
      await browser.close().catch(() => {});
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: 500 }
      );
    }
  }

  if (body.action === "logout") {
    clearBilibiliSession();
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "未知 action" }, { status: 400 });
}
