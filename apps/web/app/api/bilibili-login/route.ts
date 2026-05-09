import { NextRequest, NextResponse } from "next/server";
import {
  generateQrcode,
  pollQrcodeStatus,
  clearBilibiliSession,
  isLoggedIn,
  loadBilibiliSession,
  saveBilibiliSession,
} from "@/lib/bilibili-browser";

export async function GET() {
  const loggedIn = isLoggedIn();
  const session = loadBilibiliSession();
  const sessdata = session?.cookies.find((c) => c.name === "SESSDATA");
  return NextResponse.json({
    loggedIn,
    savedAt: session?.savedAt,
    sessdataHint: sessdata ? sessdata.value.slice(0, 8) + "..." : null,
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
    try {
      const result = await pollQrcodeStatus(qrcode_key);
      if (result.status === "confirmed" && result.cookieStr) {
        // 把 cookie 字符串转成对象数组存储
        const cookies = result.cookieStr
          .split(";")
          .map((c) => {
            const [name, ...rest] = c.trim().split("=");
            return {
              name: name?.trim() ?? "",
              value: rest.join("="),
              domain: ".bilibili.com",
              path: "/",
            };
          })
          .filter((c) => c.name);
        saveBilibiliSession(cookies);
      }
      return NextResponse.json({ success: true, status: result.status });
    } catch (err) {
      return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
    }
  }

  if (body.action === "logout") {
    clearBilibiliSession();
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "未知 action" }, { status: 400 });
}
