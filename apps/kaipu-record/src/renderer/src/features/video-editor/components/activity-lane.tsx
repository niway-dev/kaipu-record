/**
 * Activity lane — the EVIDENCE for the zooms (UI spec § 6.2): a tall accent tick per
 * click, a short muted bar per pointer pause (height = how long it lasted). Read-only.
 * Marks are in SOURCE seconds and mapped through source-time.ts, so a cut hides the
 * evidence of deleted footage exactly like it hides the footage.
 */
import type { ActivityMark } from "../zoom/detect-zoom-segments";
import { sourceRangeToTimelineBlocks } from "../source-time";
import { type LayoutEntry, layoutDuration, sourceToTimeline } from "../timeline";
import { timeToFraction } from "./timeline-geometry";
import styles from "./activity-lane.module.css";

const DWELL_MIN_PX = 6;
const DWELL_MAX_PX = 18;

export function ActivityLane({
  marks,
  layout,
}: {
  marks: ActivityMark[];
  layout: LayoutEntry[];
}): React.JSX.Element {
  const duration = layoutDuration(layout);
  return (
    <div className={styles.lane} data-testid="activity-lane" aria-hidden>
      {marks.flatMap((mark, i) => {
        if (mark.kind === "click") {
          const t = sourceToTimeline(layout, mark.t);
          if (t === null) return [];
          return [
            <span
              key={`c${i}`}
              className={styles.click}
              style={{ left: `${timeToFraction(t, duration) * 100}%` }}
            />,
          ];
        }
        const height = DWELL_MIN_PX + (DWELL_MAX_PX - DWELL_MIN_PX) * mark.strength;
        return sourceRangeToTimelineBlocks(layout, mark.start, mark.end).map((block, j) => (
          <span
            key={`d${i}-${j}`}
            className={styles.dwell}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
              height: `${height}px`,
            }}
          />
        ));
      })}
    </div>
  );
}
