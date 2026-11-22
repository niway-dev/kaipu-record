import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import { uiArea } from "@renderer/lib/ui-area";
import { showToast } from "@renderer/ui/toast-store";
import { formatColor, type ColorFormat } from "../color";
import {
  coverageGroups,
  deltaE,
  flatColors,
  formatShare,
  isPhoto,
  NOTABLE_MEMBER_SHARE,
  unpackRgb,
  type ColorGroup,
  type LocateTarget,
} from "./histogram";
import { sameTarget, type ColorsController } from "./use-colors";
import styles from "./colors.module.css";

/** How long a row shows "Copied" in place of its bar and share (mock F5). */
const COPIED_MS = 1500;
/** Widens a share to the bar: 100% of the image would overflow, which the track clips. */
const BAR_SCALE = 2.2;
const BAR_MIN_PERCENT = 4;
/** Placeholder rows while counting, from the full row to the faintest (mock F4). */
const SKELETON_ROWS = [
  { width: 70, opacity: 1 },
  { width: 90, opacity: 0.8 },
  { width: 70, opacity: 0.6 },
  { width: 90, opacity: 0.4 },
] as const;

/**
 * Exact chips show when a group has two notable values, or one plus minor values that add up
 * to a notable share: only then does the exact chip highlight something the group does not.
 * Every bin of a photo holds many exact values, so `distinct > 1` alone would add a chip to
 * nearly every row.
 */
function showMembers(group: ColorGroup): boolean {
  if (group.members.length > 1) return true;
  const hidden = group.count - group.members[0].count;
  return hidden >= group.count * NOTABLE_MEMBER_SHARE;
}

const css = (rgb: number): string => `#${rgb.toString(16).padStart(6, "0")}`;

interface RowProps {
  /** Identifies the row among the ones that can show "Copied". */
  copyKey: string;
  rgb: number;
  count: number;
  total: number;
  format: ColorFormat;
  title: string;
  target: LocateTarget;
  located: LocateTarget | null;
  copiedKey: string | null;
  nested?: boolean;
  onLocate(target: LocateTarget): void;
  onCopy(key: string, value: string): void;
}

/** One color: swatch, value, share. Clicking it highlights it; its copy action copies the value. */
function ColorRow({
  copyKey,
  rgb,
  count,
  total,
  format,
  title,
  target,
  located,
  copiedKey,
  nested = false,
  onLocate,
  onCopy,
}: RowProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const value = formatColor(unpackRgb(rgb), format);
  const on = sameTarget(target, located);
  const copied = copiedKey === copyKey;
  const percent = total > 0 ? (count / total) * 100 : 0;
  return (
    <div
      className={`${styles.row} ${on ? styles.rowOn : ""} ${nested ? styles.nested : ""}`}
      data-copied={copied}
    >
      <button
        type="button"
        className={styles.rowMain}
        aria-pressed={on}
        title={title}
        onClick={() => onLocate(target)}
      >
        <span className={styles.swatch} style={{ background: css(rgb) }} />
        <span className={styles.value}>{value}</span>
        {copied ? (
          <span className={styles.copiedMark}>
            <Check size={12} strokeWidth={3} />
            {t("inspectCopied")}
          </span>
        ) : (
          <>
            <span className={styles.bar} aria-hidden>
              <span
                className={styles.barFill}
                style={{
                  width: `${Math.min(100, Math.max(BAR_MIN_PERCENT, percent * BAR_SCALE))}%`,
                }}
              />
            </span>
            <span className={styles.share}>{formatShare(count, total)}</span>
          </>
        )}
      </button>
      <button
        type="button"
        className={`${styles.copy} ${copied ? styles.copyHidden : ""}`}
        aria-label={t("inspectColorsCopyRow", { color: value })}
        onClick={() => onCopy(copyKey, value)}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}

/** The "Other" row of a photo: what the groups shown leave out. Neither highlights nor copies. */
function OtherRow({ count, total }: { count: number; total: number }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const percent = total > 0 ? (count / total) * 100 : 0;
  return (
    <li className={styles.item} data-other>
      <div className={`${styles.row} ${styles.rowStatic}`}>
        <div className={`${styles.rowMain} ${styles.rowStatic}`}>
          <span className={`${styles.swatch} ${styles.swatchOther}`} />
          <span className={styles.label}>{t("inspectColorsOther")}</span>
          <span className={styles.bar} aria-hidden>
            <span
              className={styles.barFill}
              style={{ width: `${Math.min(100, Math.max(BAR_MIN_PERCENT, percent * BAR_SCALE))}%` }}
            />
          </span>
          <span className={styles.share}>{formatShare(count, total)}</span>
        </div>
      </div>
    </li>
  );
}

interface ListProps {
  total: number;
  format: ColorFormat;
  located: LocateTarget | null;
  copiedKey: string | null;
  onLocate(target: LocateTarget): void;
  onCopy(key: string, value: string): void;
}

/**
 * A group as one row. With two notable exact values it is a box (mock F2): the values the
 * panel thinks were meant to be one color, side by side, with the distance between the top two
 * and a "Show both" button that highlights the group. With one notable value plus minor ones
 * it is the row and an indented exact row; otherwise just the row.
 */
function GroupItem({
  group,
  grouping,
  ...list
}: ListProps & { group: ColorGroup; grouping: boolean }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const groupTarget: LocateTarget = { kind: "group", id: group.id };
  const groupValue = formatColor(unpackRgb(group.rgb), list.format);
  const groupTitle = t("inspectColorsLocateGroup", { color: groupValue });
  const memberRow = (member: ColorGroup["members"][number], nested: boolean): React.JSX.Element => {
    const value = formatColor(unpackRgb(member.rgb), list.format);
    return (
      <ColorRow
        key={member.rgb}
        {...list}
        copyKey={`c${member.rgb}`}
        rgb={member.rgb}
        count={member.count}
        title={t("inspectColorsLocateColor", { color: value })}
        target={{ kind: "color", rgb: member.rgb }}
        nested={nested}
      />
    );
  };

  if (grouping && group.members.length > 1) {
    const groupOn = sameTarget(groupTarget, list.located);
    return (
      <li className={styles.item} data-group={group.id}>
        <div className={styles.box}>
          <div className={styles.boxHead}>
            <span className={styles.boxTitle}>{t("inspectColorsAlmostSame")}</span>
            <span className={styles.boxDelta}>
              {t("inspectColorsDeltaE", {
                value: deltaE(group.members[0].rgb, group.members[1].rgb).toFixed(1),
              })}
            </span>
            <span className={styles.spacer} />
            <button
              type="button"
              className={`${styles.showBoth} ${groupOn ? styles.showBothOn : ""}`}
              aria-pressed={groupOn}
              title={groupTitle}
              onClick={() => list.onLocate(groupTarget)}
            >
              {t("inspectColorsShowBoth")}
              <span className={styles.srOnly}>{groupValue}</span>
              <span className={styles.srOnly}>{formatShare(group.count, list.total)}</span>
            </button>
          </div>
          {group.members.map((member) => memberRow(member, false))}
        </div>
      </li>
    );
  }

  return (
    <li className={styles.item} data-group={group.id}>
      <ColorRow
        {...list}
        copyKey={`g${group.id}`}
        rgb={group.rgb}
        count={group.count}
        title={groupTitle}
        target={groupTarget}
      />
      {grouping && showMembers(group) && group.members.map((member) => memberRow(member, true))}
    </li>
  );
}

function GroupSwitch({ on, onToggle }: { on: boolean; onToggle(): void }): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`${styles.switch} ${on ? styles.switchOn : ""}`}
      onClick={onToggle}
    >
      <span className={styles.track}>
        <span className={styles.knob} />
      </span>
      {t("inspectColorsGroup")}
    </button>
  );
}

/** Counting, or Inspect still reading the pixels: a bar and placeholder rows (mock F4). */
function CountingView({ percent }: { percent: number | null }): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div className={styles.counting}>
      <span className={styles.countingText}>
        {percent === null ? t("inspectColorsCounting") : t("inspectColorsProgress", { percent })}
      </span>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label={t("inspectColorsCounting")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div className={styles.progressFill} style={{ width: `${percent ?? 0}%` }} />
      </div>
      {SKELETON_ROWS.map((row, index) => (
        <div key={index} className={styles.skeleton} style={{ opacity: row.opacity }} aria-hidden>
          <span className={styles.skeletonSwatch} />
          <span className={styles.skeletonBar} style={{ width: row.width }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The Colors tab: the image's colors, largest first, each with its share. With Group on, a
 * group with more than one notable exact value lists them in a box, so two whites that should
 * have been one are side by side; Group off lists every exact value. A photograph lists the
 * groups that cover most of the image and folds the rest into "Other". Clicking a row
 * highlights where that color is in the image. Values are sRGB in the Inspect bar's format.
 */
function ColorsPanelView({
  colors,
  format,
  reading,
  unreadable = false,
  grouped,
  onGroupedChange,
}: {
  colors: ColorsController;
  format: ColorFormat;
  /** Inspect is still decoding the pixels. */
  reading: boolean;
  /** Inspect could not decode the pixels, so there is nothing to count. */
  unreadable?: boolean;
  /** Group is on. Owned by the page, so it survives the panel unmounting on a tab switch. */
  grouped: boolean;
  onGroupedChange(grouped: boolean): void;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { analysis, status, progress, located, overlay } = colors;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    // Set on mount too: StrictMode's dev replay runs the cleanup once, then mounts again.
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (key: string, value: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(value);
      } catch (error) {
        // Otherwise "Copied" just never shows and the user cannot tell the copy failed.
        reportError(t("inspectCopyError"), error, { context: { phase: "inspect-colors-copy" } });
        return;
      }
      showToast({ message: t("inspectColorsCopiedToast", { color: value }) });
      if (!alive.current) return;
      setCopiedKey(key);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), COPIED_MS);
    },
    [t],
  );

  const failed = status === "error" || unreadable;
  const photo = analysis !== null && isPhoto(analysis);
  const counting = !analysis && !failed && (reading || status === "counting");
  const state = located
    ? "located"
    : status === "ready"
      ? photo
        ? "photo"
        : "list"
      : failed
        ? "error"
        : status;
  const percent =
    status === "counting" && progress !== null ? Math.round(Math.min(1, progress) * 100) : null;

  const list: ListProps | null = analysis && {
    total: analysis.counted,
    format,
    located,
    copiedKey,
    onLocate: colors.locate,
    onCopy: (key, value) => void copy(key, value),
  };
  const shown = analysis && photo ? coverageGroups(analysis) : null;
  const boxes =
    analysis && !photo && grouped ? analysis.groups.filter((g) => g.members.length > 1).length : 0;

  return (
    <section
      {...uiArea("editorImage.inspectColors")}
      className={styles.panel}
      aria-label={t("inspectColorsLabel")}
      data-state={state}
      data-grouped={grouped && !photo}
    >
      {counting && <CountingView percent={percent} />}
      {failed && <span className={styles.status}>{t("inspectColorsUnavailable")}</span>}
      {analysis && list && (
        <>
          <div className={styles.header}>
            <span className={styles.summary}>
              {t("inspectColorsSummary", {
                groups: analysis.totalGroups,
                distinct: analysis.distinct,
              })}
            </span>
            <span className={styles.order}>{t("inspectColorsOrder")}</span>
            <span className={styles.spacer} />
            {!photo && (
              <GroupSwitch
                on={grouped}
                onToggle={() => {
                  // A highlighted row may not exist in the other list.
                  if (located) colors.locate(null);
                  onGroupedChange(!grouped);
                }}
              />
            )}
          </div>
          {/* Above the list, not under it as in the mock: a photo lists a couple of hundred
              groups, so a card at the end would never be seen. */}
          {shown && (
            <div className={styles.photo}>
              <p className={styles.photoTitle}>{t("inspectColorsPhotoTitle")}</p>
              <p className={styles.photoBody}>
                {t("inspectColorsPhotoBody", {
                  distinct: analysis.distinct,
                  shown: shown.groups.length,
                  // What the groups shown really cover: every group of at least
                  // PHOTO_GROUP_SHARE, so the rest (the "Other" row) is what is left.
                  percent:
                    analysis.counted > 0
                      ? Math.floor(((analysis.counted - shown.other) * 100) / analysis.counted)
                      : 0,
                })}
              </p>
            </div>
          )}
          {analysis.groups.length === 0 && (
            <span className={styles.status}>{t("inspectColorsEmpty")}</span>
          )}
          {analysis.groups.length > 0 && (
            <ul className={styles.list}>
              {shown
                ? shown.groups.map((group) => (
                    <GroupItem key={group.id} {...list} group={group} grouping={false} />
                  ))
                : grouped
                  ? analysis.groups.map((group) => (
                      <GroupItem key={group.id} {...list} group={group} grouping />
                    ))
                  : flatColors(analysis).map((member) => {
                      const value = formatColor(unpackRgb(member.rgb), format);
                      return (
                        <li key={member.rgb} className={styles.item}>
                          <ColorRow
                            {...list}
                            copyKey={`c${member.rgb}`}
                            rgb={member.rgb}
                            count={member.count}
                            title={t("inspectColorsLocateColor", { color: value })}
                            target={{ kind: "color", rgb: member.rgb }}
                          />
                        </li>
                      );
                    })}
              {shown && shown.other > 0 && (
                <OtherRow count={shown.other} total={analysis.counted} />
              )}
            </ul>
          )}
          {boxes > 0 && <p className={styles.note}>{t("inspectColorsPairs", { boxes })}</p>}
          {!photo && grouped && analysis.totalGroups > analysis.groups.length && (
            <span className={styles.status}>
              {t("inspectColorsMore", {
                shown: analysis.groups.length,
                total: analysis.totalGroups,
              })}
            </span>
          )}
        </>
      )}
      {located && (
        <>
          <div className={styles.footer}>
            <span className={styles.status}>
              {overlay ? t("inspectColorsMatched", { count: overlay.matched }) : "…"}
            </span>
            <button type="button" className={styles.clear} onClick={() => colors.locate(null)}>
              <X size={12} />
              {t("inspectColorsClear")}
            </button>
          </div>
          <p className={styles.note}>{t("inspectColorsLocatedNote")}</p>
        </>
      )}
    </section>
  );
}

/** Memoized: the page re-renders on every hover move, the list only when its inputs change. */
export const ColorsPanel = React.memo(ColorsPanelView);
