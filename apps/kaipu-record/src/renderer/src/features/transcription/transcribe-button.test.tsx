import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TranscriptionModelInfo, TranscriptionStatus } from "@shared/types/transcription";
import { TranscribeButton, type TranscribeButtonVariant } from "./transcribe-button";
import type { TranscribeControlState } from "./transcribe-control";
import type { TranscribeControl } from "./use-transcribe-control";

const hook = vi.hoisted(() => ({ control: null as unknown }));
vi.mock("./use-transcribe-control", () => ({ useTranscribeControl: () => hook.control }));

const MODEL_ID = "parakeet-tdt-0.6b-v3-int8";

function modelOf(status: TranscriptionModelInfo["status"]): TranscriptionModelInfo {
  return {
    id: MODEL_ID,
    label: "Parakeet TDT 0.6B v3",
    languages: ["en", "es"],
    sizeBytes: 640_000_000,
    location: "/models/parakeet",
    license: { name: "CC-BY-4.0", attribution: "By NVIDIA.", url: "https://example.com/l" },
    status,
  };
}

function statusOf(model: TranscriptionModelInfo): TranscriptionStatus {
  return {
    availability: { status: "available" },
    defaultModelId: MODEL_ID,
    models: [model],
    job: null,
  };
}

interface Fns {
  start: Mock<TranscribeControl["start"]>;
  cancel: Mock<TranscribeControl["cancel"]>;
  download: Mock<TranscribeControl["offer"]["download"]>;
  refresh: Mock<TranscribeControl["offer"]["refresh"]>;
}

function setControl(
  state: TranscribeControlState,
  model: TranscriptionModelInfo = modelOf({ state: "missing" }),
  failures: TranscribeControl["offer"]["failures"] = {},
): Fns {
  const fns: Fns = {
    start: vi.fn<TranscribeControl["start"]>(async () => null),
    cancel: vi.fn<TranscribeControl["cancel"]>(),
    download: vi.fn<TranscribeControl["offer"]["download"]>(async () => {}),
    refresh: vi.fn<TranscribeControl["offer"]["refresh"]>(async () => {}),
  };
  const control: TranscribeControl = {
    state,
    start: fns.start,
    cancel: fns.cancel,
    offer: {
      status: statusOf(model),
      failures,
      refresh: fns.refresh,
      download: fns.download,
      cancel: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  };
  hook.control = control;
  return fns;
}

const ITEM = {
  id: "a",
  assetId: "asset-a",
  mediaUrl: "kaipu-media://a.mp4",
  durationMs: 5000,
  transcribedAt: null,
};

function mount(variant: TranscribeButtonVariant = "detail", onParentClick = vi.fn()) {
  render(
    <div onClick={onParentClick}>
      <TranscribeButton item={ITEM} variant={variant} />
    </div>,
  );
  return onParentClick;
}

beforeEach(() => {
  hook.control = null;
});
afterEach(cleanup);

describe("TranscribeButton", () => {
  it.each<TranscribeControlState["kind"]>(["hidden", "unavailable", "loading"])(
    "renders nothing for %s",
    (kind) => {
      setControl({ kind } as TranscribeControlState);
      mount();
      expect(document.body.querySelector("button")).toBeNull();
      expect(screen.queryByTestId("transcribe-done")).toBeNull();
    },
  );

  it("idle: a Transcribe button that starts the job", () => {
    const fns = setControl({ kind: "idle" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(fns.start).toHaveBeenCalledTimes(1);
  });

  it("stale: says Transcribe again and starts the job", () => {
    const fns = setControl({ kind: "stale" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    expect(fns.start).toHaveBeenCalledTimes(1);
  });

  it("invalid: Transcribe with a hint that the transcript could not be read", () => {
    const fns = setControl({ kind: "invalid" });
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(/could not be read/i);
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(fns.start).toHaveBeenCalledTimes(1);
  });

  it("failed: Transcribe with a short hint for the failure, and it retries", () => {
    const fns = setControl({ kind: "failed", failure: "no-audio" });
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("This video has no audio to transcribe.");
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(fns.start).toHaveBeenCalledTimes(1);
  });

  it("failed: an unknown failure code gets the generic hint", () => {
    setControl({ kind: "failed", failure: "something-new" as never });
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Transcription failed. Try again.");
  });

  it("needs-model: Transcribe opens the download offer instead of starting", () => {
    const fns = setControl({ kind: "needs-model" });
    mount();
    expect(screen.queryByTestId("model-offer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    expect(fns.start).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByTestId("model-offer")).toHaveAttribute("data-state", "missing");
    expect(fns.refresh).toHaveBeenCalled();
  });

  it("needs-model: the dialog's download is 'Download in background' and calls the download", () => {
    const fns = setControl({ kind: "needs-model" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    fireEvent.click(screen.getByRole("button", { name: "Download in background" }));

    expect(fns.download).toHaveBeenCalledTimes(1);
    expect(fns.download).toHaveBeenCalledWith(MODEL_ID);
  });

  it("needs-model: closing the dialog never starts or downloads anything", () => {
    const fns = setControl({ kind: "needs-model" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fns.download).not.toHaveBeenCalled();
    expect(fns.start).not.toHaveBeenCalled();
  });

  it("needs-model: Escape closes the dialog", () => {
    setControl({ kind: "needs-model" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("needs-model: the dialog goes away once the download has started", () => {
    setControl({ kind: "needs-model" });
    const view = render(<TranscribeButton item={ITEM} variant="detail" />);
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    setControl({ kind: "model-downloading" });
    view.rerender(<TranscribeButton item={ITEM} variant="detail" />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("needs-model: a failed download shows a hint, and a click reopens the offer with the reason", () => {
    setControl({ kind: "needs-model" }, modelOf({ state: "missing" }), {
      [MODEL_ID]: "hash-mismatch",
    });
    mount("detail");

    const hint = "The speech model download failed. Click to see why and try again.";
    expect(screen.getByRole("status")).toHaveTextContent(hint);
    const button = screen.getByRole("button", { name: "Transcribe" });
    expect(button).toHaveAttribute("title", hint);
    expect(button).toHaveAttribute("data-failed", "true");

    fireEvent.click(button);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("needs-model: on a compact variant the failed-download hint is the tooltip and the name", () => {
    setControl({ kind: "needs-model" }, modelOf({ state: "missing" }), {
      [MODEL_ID]: "unknown",
    });
    mount("card");

    const button = screen.getByRole("button", {
      name: /Transcribe\. The speech model download failed/,
    });
    expect(button).toHaveAttribute("title", expect.stringContaining("download failed"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("needs-model: with no failure there is no hint", () => {
    setControl({ kind: "needs-model" });
    mount("detail");

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Transcribe" })).not.toHaveAttribute("data-failed");
  });

  it("model-downloading: a disabled button with the percent", () => {
    setControl(
      { kind: "model-downloading" },
      modelOf({ state: "downloading", receivedBytes: 320, totalBytes: 640 }),
    );
    mount();
    const button = screen.getByRole("button", { name: "Downloading model… 50%" });
    expect(button).toBeDisabled();
  });

  it("model-downloading: without byte counts the label has no percent", () => {
    setControl({ kind: "model-downloading" });
    mount();
    expect(screen.getByRole("button", { name: "Downloading model…" })).toBeDisabled();
  });

  it("running: shows segments done of total and a Cancel that cancels", () => {
    const fns = setControl({
      kind: "running",
      phase: "transcribing",
      segmentsDone: 3,
      segmentsTotal: 12,
    });
    mount();
    expect(screen.getByTestId("transcribe-progress")).toHaveTextContent("Transcribing 3/12");
    expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel transcription" }));

    expect(fns.cancel).toHaveBeenCalledTimes(1);
  });

  it("running: starting (hashing the file) is a pending state with Cancel", () => {
    setControl({ kind: "running", phase: "starting", segmentsDone: 0, segmentsTotal: 0 });
    mount();
    expect(screen.getByTestId("transcribe-progress")).toHaveTextContent("Starting…");
    expect(screen.getByRole("button", { name: "Cancel transcription" })).toBeInTheDocument();
  });

  it("running: before the segment count is known it says Transcribing…", () => {
    setControl({ kind: "running", phase: "receiving-audio", segmentsDone: 0, segmentsTotal: 0 });
    mount();
    expect(screen.getByTestId("transcribe-progress")).toHaveTextContent("Transcribing…");
  });

  it("busy-elsewhere: disabled, and the tooltip says another video is being transcribed", () => {
    const fns = setControl({ kind: "busy-elsewhere" });
    mount();
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Another video is being transcribed. Wait for it to finish.",
    );
    fireEvent.click(button);
    expect(fns.start).not.toHaveBeenCalled();
  });

  it("done: a Transcribed badge that is not a button", () => {
    setControl({ kind: "done" });
    mount();
    const badge = screen.getByTestId("transcribe-done");
    expect(badge).toHaveTextContent("Transcribed");
    // Named on the badge itself: the editor's title bar can hide the word.
    expect(screen.getByRole("img", { name: "Transcribed" })).toBe(badge);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never says Translate, in any state", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "stale" },
      { kind: "failed", failure: "unknown" },
      { kind: "done" },
    ] as TranscribeControlState[]) {
      setControl(state);
      const { unmount } = render(<TranscribeButton item={ITEM} variant="editor" />);
      expect(document.body.textContent).not.toMatch(/translat/i);
      unmount();
    }
  });

  describe("variants", () => {
    it.each<TranscribeButtonVariant>(["detail", "editor"])("%s shows the word", (variant) => {
      setControl({ kind: "idle" });
      mount(variant);
      expect(screen.getByRole("button", { name: "Transcribe" })).toHaveTextContent("Transcribe");
    });

    it.each<TranscribeButtonVariant>(["card", "row"])(
      "%s is icon-only with the label as its accessible name and tooltip",
      (variant) => {
        setControl({ kind: "idle" });
        mount(variant);
        const button = screen.getByRole("button", { name: "Transcribe" });
        expect(button).toHaveTextContent("");
        expect(button).toHaveAttribute("title", "Transcribe");
      },
    );

    it("a failure hint is the tooltip and part of the name on a compact variant", () => {
      setControl({ kind: "failed", failure: "engine-failed" });
      mount("card");
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", "Transcription failed. Try again.");
      expect(button).toHaveAccessibleName("Transcribe. Transcription failed. Try again.");
    });

    it("carries the data-ui-area it is given", () => {
      setControl({ kind: "idle" });
      render(
        <TranscribeButton
          item={ITEM}
          variant="card"
          ui={{ "data-ui-area": "library.videoCardTranscribe" }}
        />,
      );
      expect(document.querySelector('[data-ui-area="library.videoCardTranscribe"]')).not.toBeNull();
    });
  });

  describe("clicks stay inside", () => {
    it.each<TranscribeControlState>([
      { kind: "idle" },
      { kind: "needs-model" },
      { kind: "running", phase: "transcribing", segmentsDone: 1, segmentsTotal: 2 },
      { kind: "busy-elsewhere" },
      { kind: "done" },
    ])("a click on the control (%o) does not reach the parent", (state) => {
      setControl(state);
      const onParentClick = mount("card");
      const target =
        document.querySelector("button:not(:disabled)") ??
        screen.queryByTestId("transcribe-done") ??
        document.querySelector("button");
      fireEvent.click(target as Element);
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it("a click inside the open dialog does not reach the parent", () => {
      setControl({ kind: "needs-model" });
      const onParentClick = mount("card");
      fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

      fireEvent.click(screen.getByRole("button", { name: "Download in background" }));
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));

      expect(onParentClick).not.toHaveBeenCalled();
    });
  });
});
