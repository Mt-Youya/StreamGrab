import { NextRequest, NextResponse } from "next/server";
import { deleteHistory } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteHistory(id);
  return NextResponse.json({ success: true });
}
