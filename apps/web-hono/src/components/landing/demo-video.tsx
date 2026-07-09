import { useEffect, useRef } from "react";

interface DemoVideoProps {
  /** Base filename under /public/demos — e.g. "record" → record.webm / .mp4 / .jpg. */
  name: string;
  className?: string;
}

/**
 * A muted, looping product demo. Plays only while scrolled into view (and never
 * under `prefers-reduced-motion` — the poster stays). Decorative, so it's hidden
 * from assistive tech; the neighboring copy carries the meaning.
 *
 * Graceful fallback: the card background + border frame the box, so before a clip
 * (or its poster) exists the section still looks intentional — the page ships
 * without any demo file present.
 */
export function DemoVideo({ name, className }: DemoVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] ${className ?? ""}`}
    >
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={`/demos/${name}.jpg`}
        aria-hidden="true"
        className="h-full w-full object-cover"
      >
        <source src={`/demos/${name}.webm`} type="video/webm" />
        <source src={`/demos/${name}.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}
