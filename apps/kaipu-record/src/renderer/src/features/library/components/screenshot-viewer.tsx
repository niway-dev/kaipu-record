import { Check, Copy, ImageOff, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./screenshot-viewer.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** Zoom steps; 1 is "Fit" (the whole image inside the frame). */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

interface ScreenshotViewerProps {
  src?: string | null;
  /** Called once the image has loaded, with its natural pixel size. */
  onNaturalSize?(width: number, height: number): void;
  /** Copies the image to the clipboard; resolves true when it did. Given, a copy button shows
   *  over the image's top-right corner on hover (and on keyboard focus). */
  onCopy?(): Promise<boolean>;
}

/** How long the copy button keeps its check mark after a copy. */
const COPIED_MS = 1500;

/** Saved-screenshot viewer for the library detail page — the image-kind counterpart
 *  of RecordingPlayer. Shows the stored PNG (served via kaipu-media://screenshot/id),
 *  with zoom controls under it: `−`, Fit and `+`, and an optional copy button over it. */
export function ScreenshotViewer({
  src,
  onNaturalSize,
  onCopy,
}: ScreenshotViewerProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const tLibrary = useTranslations("library");
  const [failed, setFailed] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const zoom = ZOOM_STEPS[zoomIndex]!;
  // The size the image has at Fit: natural size, capped to the frame. Zooming out scales it.
  const fitSize =
    natural && frame && natural.width > 0 && natural.height > 0
      ? (() => {
          const scale = Math.min(1, frame.width / natural.width, frame.height / natural.height);
          return {
            width: natural.width * scale,
            height: natural.height * scale,
          };
        })()
      : null;
  const shown = Boolean(src) && !failed;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    if (!onCopy) return;
    if (await onCopy()) setCopied(true);
  };

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setFrame((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div {...uiArea("libraryDetail.preview")} className={styles.root}>
      {/* The frame scrolls when zoomed; the copy button sits outside it so it stays put. */}
      <div className={styles.stage}>
        <div ref={frameRef} className={styles.viewer} data-zoomed={zoom > 1 ? "true" : "false"}>
          {shown ? (
            <img
              src={src!}
              alt=""
              className={styles.image}
              style={
                zoom === 1
                  ? undefined
                  : zoom < 1
                    ? fitSize
                      ? // Zoomed out: a fraction of the size shown at Fit, so a small image shrinks
                        // too and a tall one never passes the Fit box.
                        { width: `${zoom * fitSize.width}px` }
                      : // Frame or image size not known yet: scale the frame-bound max size.
                        {
                          maxWidth: `${zoom * 100}%`,
                          maxHeight: `${zoom * 100}%`,
                        }
                    : {
                        width: `${zoom * 100}%`,
                        maxWidth: "none",
                        maxHeight: "none",
                      }
              }
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                setNatural({ width: naturalWidth, height: naturalHeight });
                onNaturalSize?.(naturalWidth, naturalHeight);
              }}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className={styles.unavailable}>
              <ImageOff size={28} strokeWidth={1.5} />
              {tLibrary("imageUnavailable")}
            </div>
          )}
        </div>
        {shown && onCopy && (
          <button
            type="button"
            className={styles.copyButton}
            data-copied={copied ? "true" : "false"}
            aria-label={tLibrary("copyImage")}
            title={tLibrary("copyImage")}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={14} strokeWidth={2} aria-hidden />
            ) : (
              <Copy size={14} strokeWidth={1.8} aria-hidden />
            )}
          </button>
        )}
      </div>
      {shown && (
        <div className={styles.controls}>
          <span className={styles.natural}>
            {natural ? `${natural.width} × ${natural.height} px` : ""}
          </span>
          <button
            type="button"
            className={styles.zoomButton}
            aria-label={t("shotZoomOut")}
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          >
            <Minus size={13} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.fit}
            aria-label={t("shotZoomFit")}
            onClick={() => setZoomIndex(FIT_INDEX)}
          >
            {t("shotZoomFit")}
          </button>
          <button
            type="button"
            className={styles.zoomButton}
            aria-label={t("shotZoomIn")}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          >
            <Plus size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
