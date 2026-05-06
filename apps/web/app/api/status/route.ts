import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@streamgrab/core";
import type { StatusApiResponse } from "@streamgrab/types";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
  }

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const response: StatusApiResponse = {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    error: task.error,
  };

  return NextResponse.json(response);
}
