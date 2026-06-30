import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalLibrary } from "./use-local-library";
import type { LocalRecording } from "@shared/types";

const recordings: LocalRecording[] = [
  {
    id: "a",
    title: "A",
    filePath: "/vault/a.webm",
    createdAt: 2000,
    sizeBytes: 100,
    durationSeconds: 10,
    thumbnailUrl: null,
    kind: "recording",
  },
  {
    id: "b",
    title: "B",
    filePath: "/vault/b.webm",
    createdAt: 1000,
    sizeBytes: 200,
    durationSeconds: 20,
    thumbnailUrl: null,
    kind: "recording",
  },
];

describe("useLocalLibrary", () => {
  beforeEach(() => {
    window.electronAPI.listLocalRecordings = vi.fn(async () => recordings);
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
  });

  it("maps local recordings to library videos tagged as local", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.videos).toHaveLength(2);
    expect(result.current.videos[0]).toMatchObject({
      id: "a",
      title: "A",
      fileSizeBytes: 100,
      durationSeconds: 10,
      storage: "local",
    });
  });

  it("removes a recording from state after delete resolves", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    expect(window.electronAPI.deleteLocalRecording).toHaveBeenCalledWith("a");
    expect(result.current.videos.map((v) => v.id)).toEqual(["b"]);
  });
});
