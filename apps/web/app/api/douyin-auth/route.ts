import { NextResponse } from "next/server";

// 此接口已废弃——抖音解析现在直接由 Playwright 拦截浏览器 API 响应完成，
// 无需预先获取 cookie。保留文件以免旧前端调用 404。
export async function POST() {
  return NextResponse.json({ success: true, message: "无需预热，解析时自动处理" });
}
