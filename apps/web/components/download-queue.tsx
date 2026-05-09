"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, Loader2, Trash2 } from "lucide-react";
import type { StatusApiResponse } from "@streamgrab/types";
import { cn } from "@/lib/utils";

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
  const updateTaskInQueue = useAppStore((s) => s.updateTaskInQueue);
  const removeFromQueue = useAppStore((s) => s.removeFromQueue);
  useTaskPolling(taskId);

  if (!task) return null;

  const isDone = task.status === "done";
  const isError = task.status === "error";

  return (
    <div className="flex items-start gap-3 py-2.5">
      {/* 状态图标 */}
      <div className="mt-0.5 shrink-0">
        {task.status === "pending" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="排队中" />
        )}
        {task.status === "downloading" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="下载中" />
        )}
        {isDone && (
          <CheckCircle className="h-4 w-4 text-[#4fffb0]" aria-label="已完成" />
        )}
        {isError && (
          <XCircle className="h-4 w-4 text-destructive" aria-label="失败" />
        )}
      </div>

      {/* 文件名 + 进度 + 错误 */}
      <div className="flex-1 min-w-0 space-y-1">
        <p className={cn(
          "text-sm truncate",
          isDone ? "text-muted-foreground" : "text-foreground font-medium"
        )}>
          {task.filename}
        </p>
        {task.status === "downloading" && (
          <div className="flex items-center gap-2">
            <Progress value={task.progress} className="h-1 flex-1" />
            <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
              {task.progress}%
            </span>
          </div>
        )}
        {isError && (
          <p className="text-xs text-destructive">
            {task.error ?? "下载失败，请重试"}
          </p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        {isError && (
          <button
            type="button"
            onClick={() => updateTaskInQueue(task.taskId, { status: "pending", progress: 0, error: undefined })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded"
            aria-label="重试"
          >
            重试
          </button>
        )}
        <button
          type="button"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => removeFromQueue(task.taskId)}
          aria-label={`移除 ${task.filename}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
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
    <div className="border border-border rounded-lg overflow-hidden">
      {/* 队列标头 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          下载队列
        </span>
        {hasCompleted && (
          <button
            type="button"
            onClick={clearCompleted}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            清除已完成
          </button>
        )}
      </div>

      {/* 任务列表 */}
      <div className="divide-y divide-border bg-card px-4">
        {queue.map((task) => (
          <TaskRow key={task.taskId} taskId={task.taskId} />
        ))}
      </div>
    </div>
  );
}
