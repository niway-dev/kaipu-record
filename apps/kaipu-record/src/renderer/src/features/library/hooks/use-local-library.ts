import { useCallback, useEffect, useState } from "react";
import type { LocalRecording } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";

function toLibraryVideo(recording: LocalRecording): LibraryVideo {
  return {
    id: recording.id,
    kind: recording.kind,
    title: recording.title,
    createdAt: recording.createdAt,
    durationSeconds: recording.durationSeconds,
    fileSizeBytes: recording.sizeBytes,
    thumbnailUrl: recording.thumbnailUrl ?? null,
    storage: "local",
  };
}

export interface LocalLibrary {
  videos: LibraryVideo[];
  isLoading: boolean;
  refresh(): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  reveal(id: string): void;
}

/** Loads + manages the local recordings vault via the main process. */
export function useLocalLibrary(): LocalLibrary {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const recordings = await window.electronAPI.listLocalRecordings();
      setVideos(recordings.map(toLibraryVideo));
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    await window.electronAPI.renameLocalRecording(id, title);
    setVideos((prev) => prev.map((video) => (video.id === id ? { ...video, title } : video)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await window.electronAPI.deleteLocalRecording(id);
    setVideos((prev) => prev.filter((video) => video.id !== id));
  }, []);

  const reveal = useCallback((id: string) => {
    void window.electronAPI.revealLocalRecording(id);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { videos, isLoading, refresh, rename, remove, reveal };
}
