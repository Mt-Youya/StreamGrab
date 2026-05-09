"use client";

import { create } from "zustand";
import type { DownloadTask, VideoInfo } from "@streamgrab/types";

interface AppState {
  currentVideo: VideoInfo | null;
  downloadQueue: DownloadTask[];
  setCurrentVideo: (video: VideoInfo | null) => void;
  addToQueue: (task: DownloadTask) => void;
  updateTaskInQueue: (taskId: string, update: Partial<DownloadTask>) => void;
  removeFromQueue: (taskId: string) => void;
  clearCompleted: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentVideo: null,
  downloadQueue: [],

  setCurrentVideo: (video) => set({ currentVideo: video }),

  addToQueue: (task) => set((state) => ({ downloadQueue: [...state.downloadQueue, task] })),

  updateTaskInQueue: (taskId, update) =>
    set((state) => ({
      downloadQueue: state.downloadQueue.map((t) => (t.taskId === taskId ? { ...t, ...update } : t)),
    })),

  removeFromQueue: (taskId) =>
    set((state) => ({
      downloadQueue: state.downloadQueue.filter((t) => t.taskId !== taskId),
    })),

  clearCompleted: () =>
    set((state) => ({
      downloadQueue: state.downloadQueue.filter((t) => t.status !== "done" && t.status !== "error"),
    })),
}));
