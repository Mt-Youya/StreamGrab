"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, Trash2 } from "lucide-react";
import type { StatusApiResponse } from "@streamgrab/types";

function useTaskPolling(taskId: string) {
  const updateTaskInQueue = useAppStore((s) => s.updateTaskInQueue);
  const task = useAppStore((s) => s.downloadQueue.find((t) => t.taskId === taskId));

  useEffect(() => {
    if (!task || task.status === "done" || task.status === "error") return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/status?taskId=${taskId}`);
        if (!resp.ok) return;
        const data: StatusApiResponse = await resp.json();
        updateTaskInQueue(taskId, {
          status: data.status,
          progress: data.progress,
          error: data.error,
        });
      } catch {}
    }, 1000);

    return () => clearInterval(interval);
  }, [taskId, task?.status, updateTaskInQueue]);
}

function TaskRow({ taskId }: { taskId: string }) {
  const task = useAppStore((s) => s.downloadQueue.find((t) => t.taskId === taskId));
  const removeFromQueue = useAppStore((s) => s.removeFromQueue);
  useTaskPolling(taskId);

  if (!task) return null;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.filename}</p>
        {task.status === "downloading" && <Progress value={task.progress} className="mt-1 h-1.5" />}
        {task.status === "error" && <p className="text-xs text-destructive mt-0.5">{task.error ?? "下载失败"}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {task.status === "pending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {task.status === "downloading" && <span className="text-xs text-muted-foreground">{task.progress}%</span>}
        {task.status === "done" && <CheckCircle className="h-4 w-4 text-green-500" />}
        {task.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeFromQueue(task.taskId)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function DownloadQueue() {
  const queue = useAppStore((s) => s.downloadQueue);
  const clearCompleted = useAppStore((s) => s.clearCompleted);

  if (queue.length === 0) return null;

  const hasCompleted = queue.some((t) => t.status === "done" || t.status === "error");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">下载队列</CardTitle>
          {hasCompleted && (
            <Button variant="ghost" size="sm" onClick={clearCompleted} className="h-7 text-xs">
              清除已完成
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 divide-y">
        {queue.map((task) => (
          <TaskRow key={task.taskId} taskId={task.taskId} />
        ))}
      </CardContent>
    </Card>
  );
}
