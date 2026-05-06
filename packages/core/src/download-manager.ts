import type { DownloadStatus, DownloadTask } from "@streamgrab/types";

const tasks = new Map<string, DownloadTask>();

export function createTask(taskId: string, filename: string): DownloadTask {
  const task: DownloadTask = {
    taskId,
    status: "pending",
    progress: 0,
    filename,
    createdAt: Date.now(),
  };
  tasks.set(taskId, task);
  return task;
}

export function updateTask(
  taskId: string,
  update: Partial<Pick<DownloadTask, "status" | "progress" | "error">>
): void {
  const task = tasks.get(taskId);
  if (!task) return;
  Object.assign(task, update);
}

export function getTask(taskId: string): DownloadTask | null {
  return tasks.get(taskId) ?? null;
}

export function setStatus(taskId: string, status: DownloadStatus, error?: string): void {
  updateTask(taskId, { status, ...(error ? { error } : {}) });
}

export function setProgress(taskId: string, progress: number): void {
  updateTask(taskId, { progress: Math.min(100, Math.max(0, progress)) });
}
