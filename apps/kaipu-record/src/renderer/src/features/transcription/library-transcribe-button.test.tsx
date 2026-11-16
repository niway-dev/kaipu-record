import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { EditorTranscribeButton } from "./editor-transcribe-button";
import { LibraryTranscribeButton } from "./library-transcribe-button";

const seen = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("./transcribe-button", () => ({
  TranscribeButton: (props: unknown) => {
    seen.props.push(props);
    return <span data-testid="transcribe-button" />;
  },
}));

const VIDEO: LibraryVideo = {
  id: "take-1",
  assetId: "asset-1",
  kind: "recording",
  title: "Take",
  createdAt: 1,
  durationSeconds: 12.5,
  fileSizeBytes: 1,
  cloudSizeBytes: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  transcribedAt: 99,
};

afterEach(() => {
  cleanup();
  seen.props.length = 0;
});

describe("LibraryTranscribeButton", () => {
  it("passes the recording's media, duration and transcript time to the button", () => {
    const { getByTestId } = render(<LibraryTranscribeButton video={VIDEO} variant="card" />);
    expect(getByTestId("transcribe-button")).toBeInTheDocument();
    const props = seen.props[0] as { variant: string; item: Record<string, unknown> };
    expect(props.variant).toBe("card");
    expect(props.item).toMatchObject({
      id: "take-1",
      assetId: "asset-1",
      durationMs: 12_500,
      transcribedAt: 99,
    });
    expect(String(props.item.mediaUrl)).toMatch(/^kaipu-media:/);
    expect(String(props.item.mediaUrl)).toContain("take-1");
  });

  it.each([
    ["a screenshot", { kind: "screenshot" as const }],
    ["a GIF export", { kind: "gif" as const }],
    ["a cloud-only item", { id: null }],
  ])("renders nothing for %s", (_name, over) => {
    const { queryByTestId } = render(
      <LibraryTranscribeButton video={{ ...VIDEO, ...over }} variant="row" />,
    );
    expect(queryByTestId("transcribe-button")).toBeNull();
  });

  it("renders nothing for a video known to have no audio, and shows for unknown or true", () => {
    const { queryByTestId, rerender } = render(
      <LibraryTranscribeButton video={VIDEO} variant="detail" hasAudio={false} />,
    );
    expect(queryByTestId("transcribe-button")).toBeNull();
    rerender(<LibraryTranscribeButton video={VIDEO} variant="detail" hasAudio={true} />);
    expect(queryByTestId("transcribe-button")).not.toBeNull();
    rerender(<LibraryTranscribeButton video={VIDEO} variant="detail" />);
    expect(queryByTestId("transcribe-button")).not.toBeNull();
  });
});

describe("EditorTranscribeButton", () => {
  it("mounts the editor variant in its catalog area", () => {
    render(<EditorTranscribeButton videoId="take-1" assetId="asset-1" durationSeconds={3} />);
    const props = seen.props[0] as {
      variant: string;
      ui: unknown;
      item: Record<string, unknown>;
    };
    expect(props.variant).toBe("editor");
    expect(props.ui).toEqual({ "data-ui-area": "editorVideo.transcribe" });
    expect(props.item).toMatchObject({
      id: "take-1",
      assetId: "asset-1",
      durationMs: 3000,
      transcribedAt: null,
    });
  });

  it("passes a known transcript time through and hides for a video without audio", () => {
    const { queryByTestId, rerender } = render(
      <EditorTranscribeButton
        videoId="take-1"
        assetId="asset-1"
        durationSeconds={3}
        transcribedAt={7}
      />,
    );
    expect((seen.props[0] as { item: { transcribedAt: number } }).item.transcribedAt).toBe(7);
    rerender(
      <EditorTranscribeButton
        videoId="take-1"
        assetId="asset-1"
        durationSeconds={3}
        hasAudio={false}
      />,
    );
    expect(queryByTestId("transcribe-button")).toBeNull();
  });
});
