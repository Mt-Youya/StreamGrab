import { NextRequest, NextResponse } from "next/server";
import { listHistory } from "@/lib/db";
import type { Platform } from "@streamgrab/types";

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") as Platform | null;
  const records = listHistory(platform ?? undefined);
  return NextResponse.json({ success: true, data: records });
}
