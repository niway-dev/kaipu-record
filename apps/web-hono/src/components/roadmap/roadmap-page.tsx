import { useState, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { useRouteContext } from "@tanstack/react-router";
import { Apple, Check, Clock, Info, Minus, ShieldAlert, TriangleAlert } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { PixelGrid } from "@/components/home/pixel-grid";
import { downloadUrls } from "@/lib/download";
import {
  ROADMAP_ITEMS,
  ROADMAP_PLATFORMS,
  ROADMAP_STATES,
  platformCounts,
  stateOf,
  type PlatformFilter,
  type RoadmapItem,
  type RoadmapPlatform,
  type RoadmapState,
} from "./roadmap-config";
import { kl, palette, paletteLight, tint, tone } from "./roadmap.stylex";

/**
 * Design: Claude Design project 71546ef1, file `Kaipu Roadmap.dc.html`. The
 * layout follows it; the states do not — they come from roadmap-config.ts,
 * which is checked against the repo rather than copied from the mockup.
 *
 * Styled in StyleX (ADR 0008: new web UI). The landing around it is still CSS
 * Modules over `--kl-*`, which this page reads through `kl` in roadmap.stylex.ts.
 *
 * Each state carries its own icon as well as its colour, so a cell never leans
 * on colour alone.
 */

/*
 * Phones; laptop screens (desktop width, short: a 14" MacBook Pro is ~1512×900
 * of CSS pixels, less with the browser chrome), where the hero is tightened so
 * the summary and the filters land in the first screen; and narrow desktops.
 */
const PHONE = "@media (max-width: 979.98px)";
const SHORT = "@media (min-width: 980px) and (max-height: 999.98px)";
const NARROW = "@media (min-width: 980px) and (max-width: 1199.98px)";

const STATE_ICON: Record<RoadmapState, typeof Check> = {
  shipped: Check,
  inProgress: Clock,
  planned: Minus,
};

/** StyleX's class and style, plus the landing's global utility classes (kl-dots…). */
function withGlobal(props: ReturnType<typeof stylex.props>, globalClass: string) {
  return { ...props, className: `${props.className ?? ""} ${globalClass}` };
}

/**
 * The state palette's light values, for everything inside. The landing's own
 * `--kl-*` light theme comes from the shell's data-kl-theme; this page's
 * palette is StyleX's, so it takes the generated theme, as AppWindow does.
 */
export function RoadmapTheme({ children }: { children: ReactNode }) {
  const { landingTheme } = useRouteContext({ from: "__root__" });
  return <div {...stylex.props(landingTheme === "light" && paletteLight)}>{children}</div>;
}

function StateCell({ state, label }: { state: RoadmapState; label: string }) {
  const Icon = STATE_ICON[state];
  const planned = state === "planned";
  return (
    <span {...stylex.props(toneOf[state], s.state, planned && s.statePlanned)}>
      <span {...stylex.props(s.stateDot, planned && s.stateDotPlanned)} aria-hidden>
        <Icon size={10} strokeWidth={3} />
      </span>
      {label}
    </span>
  );
}

function PlatformIcon({ platform, size }: { platform: RoadmapPlatform; size: number }) {
  if (platform === "mac") return <Apple size={size} aria-hidden />;
  // lucide has no Windows mark; four squares is the conventional stand-in.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}

/** The opening screen: the promise, then one summary card per platform. */
export function RoadmapHero() {
  const t = useTranslations("roadmap");

  return (
    <section id="top" {...withGlobal(stylex.props(s.hero), "kl-dots")}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <div {...stylex.props(s.heroPixels)}>
        <PixelGrid />
      </div>

      <div {...stylex.props(s.container)}>
        <p {...stylex.props(s.eyebrow, s.eyebrowPink)}>{t("page.eyebrow")}</p>
        <h1 {...stylex.props(s.h1)}>{t("page.heading")}</h1>
        <p {...stylex.props(s.h1Serif)}>{t("page.serif")}</p>
        <p {...stylex.props(s.lead)}>{t("page.intro")}</p>
        <p {...stylex.props(s.disclaimer)}>{t("page.disclaimer")}</p>

        <div {...stylex.props(s.summary)}>
          {ROADMAP_PLATFORMS.map((platform) => (
            <PlatformSummary key={platform} platform={platform} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformSummary({ platform }: { platform: RoadmapPlatform }) {
  const t = useTranslations("roadmap");
  const counts = platformCounts(platform);
  const total = ROADMAP_ITEMS.length;

  return (
    <article {...stylex.props(platformTint[platform], s.summaryCard)}>
      <div {...stylex.props(s.summaryHead)}>
        <span {...stylex.props(s.summaryIcon)}>
          <PlatformIcon platform={platform} size={20} />
        </span>
        <div {...stylex.props(s.summaryText)}>
          <h2 {...stylex.props(s.summaryName)}>{t(`platforms.${platform}.name`)}</h2>
          <p {...stylex.props(s.summaryLine)}>{t(`platforms.${platform}.line`)}</p>
        </div>
        {/* macOS ships today; Windows wears its own blue, as in the design. */}
        <span {...stylex.props(toneOf[platform === "mac" ? "shipped" : "win"], s.summaryBadge)}>
          {t(`platforms.${platform}.badge`)}
        </span>
      </div>
      {/* The bar repeats the counts below it, so it is decoration for a screen reader. */}
      <div {...stylex.props(s.bar)} aria-hidden>
        {ROADMAP_STATES.map((state) => (
          <span
            key={state}
            {...stylex.props(
              toneOf[state],
              s.barPart,
              state === "planned" && s.muted,
              s.barWidth(`${(counts[state] / total) * 100}%`),
            )}
          />
        ))}
      </div>
      <ul {...stylex.props(s.summaryCounts)}>
        {ROADMAP_STATES.map((state) => (
          <li key={state} {...stylex.props(toneOf[state], s.summaryCount)}>
            <span {...stylex.props(s.swatch, state === "planned" && s.muted)} aria-hidden />
            {counts[state]} {t(`status.${state}`).toLowerCase()}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The filters and the grouped list. One component because the filter bar and
 * the groups read the same state; the server renders the default (both
 * platforms, every state) so the page is complete before it hydrates.
 */
export function RoadmapList() {
  const t = useTranslations("roadmap");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [shown, setShown] = useState<Record<RoadmapState, boolean>>({
    shipped: true,
    inProgress: true,
    planned: true,
  });

  const visible = ROADMAP_ITEMS.filter((item) => shown[stateOf(item, platform)]);
  const groups = ROADMAP_STATES.filter((state) => shown[state])
    .map((state) => ({ state, items: visible.filter((item) => stateOf(item, platform) === state) }))
    .filter((group) => group.items.length > 0);

  const hint = (state: RoadmapState) =>
    state === "shipped" && platform !== "all" ? t("groupHint.shippedOne") : t(`groupHint.${state}`);

  const platformOptions: PlatformFilter[] = ["all", ...ROADMAP_PLATFORMS];

  return (
    <>
      <div {...stylex.props(s.filterBar)} role="group" aria-label={t("filters.label")}>
        <div {...stylex.props(s.filterInner)}>
          <div {...stylex.props(s.segment)} role="group" aria-label={t("filters.platform")}>
            {platformOptions.map((option) => {
              const on = platform === option;
              return (
                <button
                  key={option}
                  type="button"
                  {...stylex.props(s.button, s.segmentBtn, on && s.segmentOn)}
                  aria-pressed={on}
                  onClick={() => setPlatform(option)}
                >
                  {option !== "all" && <PlatformIcon platform={option} size={14} />}
                  {option === "all" ? t("filters.both") : t(`platforms.${option}.name`)}
                </button>
              );
            })}
          </div>
          <span {...stylex.props(s.divider)} aria-hidden />
          <div {...stylex.props(s.chips)} role="group" aria-label={t("filters.states")}>
            {ROADMAP_STATES.map((state) => {
              const on = shown[state];
              return (
                <button
                  key={state}
                  type="button"
                  {...stylex.props(
                    toneOf[state],
                    s.button,
                    s.chip,
                    on && (state === "planned" ? s.chipPlannedOn : s.chipOn),
                  )}
                  aria-pressed={on}
                  onClick={() => setShown((prev) => ({ ...prev, [state]: !prev[state] }))}
                >
                  <span {...stylex.props(s.swatch, !on && s.muted)} aria-hidden />
                  {t(`status.${state}`)}
                </button>
              );
            })}
          </div>
          <span {...stylex.props(s.spacer)} />
          <span {...stylex.props(s.showing)} aria-live="polite">
            {t("page.showing", { shown: visible.length, total: ROADMAP_ITEMS.length })}
          </span>
        </div>
      </div>

      <section {...stylex.props(s.list)}>
        <div {...stylex.props(s.container, s.groups)}>
          {groups.map(({ state, items }) => (
            <section
              key={state}
              aria-labelledby={`roadmap-${state}`}
              {...stylex.props(toneOf[state])}
            >
              <div {...stylex.props(s.groupHead)}>
                <h2 id={`roadmap-${state}`} {...stylex.props(s.groupTitle)}>
                  <span {...stylex.props(s.swatch, s.swatchLg)} aria-hidden />
                  {t(`status.${state}`)}
                </h2>
                <span {...stylex.props(s.mono)}>{t("page.count", { count: items.length })}</span>
                <span {...stylex.props(s.groupHint)}>{hint(state)}</span>
              </div>
              <div {...stylex.props(s.grid, s.columns)} aria-hidden>
                <span>{t("page.columns.feature")}</span>
                <span {...stylex.props(s.center)}>{t("page.columns.mac")}</span>
                <span {...stylex.props(s.center)}>{t("page.columns.win")}</span>
              </div>
              <ul {...stylex.props(s.rows)}>
                {items.map((item) => (
                  <RoadmapRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

function RoadmapRow({ item }: { item: RoadmapItem }) {
  const t = useTranslations("roadmap");
  const Icon = item.icon;

  return (
    <li {...stylex.props(areaTint[item.area], s.grid, s.row)}>
      <div {...stylex.props(s.rowMain)}>
        <span {...stylex.props(s.rowIcon)} aria-hidden>
          <Icon size={17} />
        </span>
        <div {...stylex.props(s.rowText)}>
          <div {...stylex.props(s.rowTitleLine)}>
            <h3 {...stylex.props(s.rowTitle)}>{t(`items.${item.id}.title`)}</h3>
            <span {...stylex.props(s.area)}>{t(`areas.${item.area}`)}</span>
          </div>
          <p {...stylex.props(s.rowDesc)}>{t(`items.${item.id}.description`)}</p>
          {"note" in item && (
            <p {...stylex.props(s.note)}>
              <Info size={12} {...stylex.props(s.noteIcon)} aria-hidden />
              {t(`items.${item.id}.note`)}
            </p>
          )}
        </div>
      </div>
      {ROADMAP_PLATFORMS.map((platform) => (
        <div key={platform} {...stylex.props(s.cell)}>
          {/* Phones stack the cells, so they name their platform themselves. */}
          <span {...stylex.props(s.cellPlatform)}>
            <PlatformIcon platform={platform} size={12} />
            {t(`platforms.${platform}.name`)}
          </span>
          <StateCell state={item[platform]} label={t(`status.${item[platform]}`)} />
        </div>
      ))}
    </li>
  );
}

/** What each state means, in one line each. */
export function RoadmapLegend() {
  const t = useTranslations("roadmap");

  return (
    <section {...stylex.props(s.legend)}>
      <div {...stylex.props(s.container, s.legendInner)}>
        <span {...stylex.props(s.eyebrow)}>{t("legend.title")}</span>
        {ROADMAP_STATES.map((state) => (
          <span key={state} {...stylex.props(s.legendItem)}>
            <StateCell state={state} label={t(`status.${state}`)} />
            {t(`legend.${state}`)}
          </span>
        ))}
      </div>
    </section>
  );
}

const STEPS = ["s1", "s2", "s3"] as const;

/**
 * Windows, said plainly: on its way, not downloadable. The design's "Download
 * for Windows (beta)" button waits for the installer on the download feed
 * (Windows release design, decision 9); until then the primary action is the
 * Mac download that exists.
 */
export function WindowsComingSoon() {
  const t = useTranslations("roadmap");

  return (
    <section id="windows" {...stylex.props(toneOf.win, s.windows)}>
      <div {...stylex.props(s.windowsGlow)} aria-hidden />
      <div {...stylex.props(s.container, s.windowsInner)}>
        <div {...stylex.props(s.windowsCopy)}>
          <div {...stylex.props(s.windowsEyebrow)}>
            <span {...stylex.props(s.eyebrow)}>{t("windows.eyebrow")}</span>
            <span {...stylex.props(s.soonBadge)}>{t("windows.badge")}</span>
          </div>
          <h2 {...stylex.props(s.h2)}>{t("windows.title")}</h2>
          <p {...stylex.props(s.h2Serif)}>{t("windows.serif")}</p>
          <p {...stylex.props(s.windowsBody)}>{t("windows.body")}</p>
          <a href={downloadUrls.macArm64} {...stylex.props(s.download)}>
            <Apple size={16} aria-hidden />
            {t("windows.download")}
          </a>
          <p {...stylex.props(s.requirements)}>{t("windows.requirements")}</p>
        </div>

        <div {...stylex.props(s.smartscreen)}>
          <div {...stylex.props(s.smartscreenHead)}>
            <span {...stylex.props(s.smartscreenIcon)} aria-hidden>
              <ShieldAlert size={17} />
            </span>
            <div>
              <h3 {...stylex.props(s.smartscreenTitle)}>{t("windows.smartscreenTitle")}</h3>
              <p {...stylex.props(s.smartscreenBody)}>{t("windows.smartscreenBody")}</p>
            </div>
          </div>
          <ol {...stylex.props(s.steps)}>
            {STEPS.map((step, i) => (
              <li key={step} {...stylex.props(s.step)}>
                <div {...stylex.props(s.stepHead)}>
                  <span {...stylex.props(s.stepNumber)}>{i + 1}</span>
                  {t(`windows.steps.${step}`)}
                </div>
                <div {...stylex.props(s.mock)} aria-hidden>
                  <StepMock step={step} />
                </div>
              </li>
            ))}
          </ol>
          <p {...stylex.props(s.betaNote)}>
            <TriangleAlert size={13} {...stylex.props(s.noteIcon)} aria-hidden />
            {t("windows.betaNote")}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * A picture of the Windows dialogs, not Kaipu's UI — so these keep Windows'
 * own colours in both themes, like the third-party content in the home's mockups.
 */
function StepMock({ step }: { step: (typeof STEPS)[number] }) {
  const t = useTranslations("roadmap");

  if (step === "s1") {
    return (
      <>
        <div {...stylex.props(s.mockTitle)}>{t("windows.mock.protected")}</div>
        <div {...stylex.props(s.mockText)}>{t("windows.mock.prevented")}</div>
        <div {...stylex.props(s.mockLink)}>{t("windows.mock.moreInfo")}</div>
      </>
    );
  }
  if (step === "s2") {
    return (
      <>
        <div {...stylex.props(s.mockText)}>{t("windows.mock.app")}</div>
        <div {...stylex.props(s.mockText)}>{t("windows.mock.publisher")}</div>
        <div {...stylex.props(s.mockButtons)}>
          <span {...stylex.props(s.mockBtn, s.mockBtnPrimary)}>{t("windows.mock.runAnyway")}</span>
          <span {...stylex.props(s.mockBtn)}>{t("windows.mock.dontRun")}</span>
        </div>
      </>
    );
  }
  return (
    <div {...stylex.props(s.mockInstall)}>
      <KaipuLogo use="product" size={30} />
      <div>
        <div {...stylex.props(s.mockTitle)}>{t("windows.mock.installs")}</div>
        <div {...stylex.props(s.mockText)}>{t("windows.mock.tray")}</div>
      </div>
    </div>
  );
}

/* ---------- variants that hand a colour down ---------- */

/** Sets `tone` for an element and everything inside it. */
const toneOf = stylex.create({
  shipped: { [tone.c]: palette.shipped, [tone.cTx]: palette.shippedTx },
  inProgress: { [tone.c]: palette.progress, [tone.cTx]: palette.progressTx },
  planned: { [tone.c]: palette.planned, [tone.cTx]: palette.plannedTx },
  win: { [tone.c]: palette.win, [tone.cTx]: palette.win },
});

/** The first four reuse the home's chapter tints; Cloud takes "Your files" blue. */
const areaTint = stylex.create({
  record: { [tint.area]: kl.c1 },
  capture: { [tint.area]: kl.c2 },
  edit: { [tint.area]: kl.c3 },
  find: { [tint.area]: kl.c4 },
  cloud: { [tint.area]: kl.c5 },
  app: { [tint.area]: kl.faint },
});

/** macOS wears the brand on this page, Windows its blue — as in the design. */
const platformTint = stylex.create({
  mac: { [tint.platform]: kl.c1 },
  win: { [tint.platform]: kl.c5 },
});

const toneBorder = `color-mix(in srgb, ${tone.c} 40%, transparent)`;
const toneFill = `color-mix(in srgb, ${tone.c} 12%, transparent)`;

const s = stylex.create({
  /* ---------- shared ---------- */
  container: {
    position: "relative",
    zIndex: 1,
    maxWidth: kl.maxW,
    marginInline: "auto",
  },
  mono: {
    fontFamily: kl.fontMono,
    fontSize: "12.5px",
    color: kl.faint,
  },
  eyebrow: {
    fontFamily: kl.fontMono,
    fontSize: "12.5px",
    letterSpacing: kl.trackingLabel,
    textTransform: "uppercase",
    color: kl.faint,
  },
  eyebrowPink: { color: kl.pinkTx },
  center: { textAlign: "center" },
  swatch: {
    display: "inline-block",
    flexShrink: 0,
    width: 7,
    height: 7,
    borderRadius: 2,
    backgroundColor: tone.c,
  },
  swatchLg: { width: 10, height: 10, borderRadius: 3 },
  muted: { backgroundColor: kl.bd2 },

  /* ---------- hero ---------- */
  hero: {
    position: "relative",
    paddingTop: { default: 128, [SHORT]: 112, [PHONE]: 112 },
    paddingBottom: { default: 56, [SHORT]: 40, [PHONE]: 44 },
    paddingInline: { default: kl.gutter, [PHONE]: 20 },
    overflow: "hidden",
  },
  heroPixels: {
    position: "absolute",
    top: { default: 110, [SHORT]: 96 },
    right: "3%",
    display: { default: "block", [PHONE]: "none" },
  },
  /*
   * Smaller than the home's --kl-fs-h1 on purpose: that scale is for a two-word
   * headline, and this one is a sentence. At 112px it filled a laptop screen on
   * its own and pushed the list — the page's content — below the fold.
   */
  h1: {
    maxWidth: 820,
    margin: "16px 0 0",
    fontSize: { default: "clamp(42px, 5.4vw, 80px)", [SHORT]: "clamp(42px, 4.6vw, 68px)" },
    fontWeight: 700,
    lineHeight: 0.94,
    letterSpacing: kl.trackingH1,
    textWrap: "balance",
  },
  h1Serif: {
    margin: "10px 0 0",
    fontFamily: kl.fontSerif,
    fontSize: { default: "clamp(28px, 3.2vw, 48px)", [SHORT]: "clamp(26px, 2.6vw, 40px)" },
    fontStyle: "italic",
    lineHeight: 1.05,
    color: kl.pinkTx,
  },
  lead: {
    maxWidth: 640,
    margin: { default: "20px 0 0", [SHORT]: "16px 0 0" },
    fontSize: "clamp(16px, 1.2vw, 18px)",
    lineHeight: kl.leadingBody,
    color: kl.dim,
    textWrap: "pretty",
  },
  disclaimer: {
    maxWidth: 640,
    margin: "12px 0 0",
    fontSize: 14,
    lineHeight: 1.6,
    color: kl.faint,
  },
  summary: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [PHONE]: "1fr" },
    gap: 12,
    marginTop: { default: 40, [SHORT]: 28 },
  },
  summaryCard: {
    position: "relative",
    padding: { default: "20px 20px 18px", [SHORT]: "16px 18px 14px" },
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: 18,
    background: `radial-gradient(70% 80% at 100% 0%, color-mix(in srgb, ${tint.platform} 14%, transparent), transparent 70%), ${kl.card}`,
  },
  summaryHead: { display: "flex", alignItems: "center", gap: 12 },
  summaryIcon: {
    display: "grid",
    flexShrink: 0,
    width: 44,
    height: 44,
    placeItems: "center",
    borderRadius: 12,
    background: `linear-gradient(145deg, color-mix(in srgb, ${tint.platform} 70%, white), color-mix(in srgb, ${tint.platform} 70%, black))`,
    color: "#fff",
    boxShadow: `0 12px 26px -12px ${tint.platform}`,
  },
  summaryText: { flex: 1, minWidth: 0 },
  summaryName: { margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.03em" },
  summaryLine: { margin: "2px 0 0", fontSize: 13, color: kl.dim },
  summaryBadge: {
    padding: "4px 9px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: toneBorder,
    borderRadius: 999,
    backgroundColor: toneFill,
    fontFamily: kl.fontMono,
    fontSize: "10.5px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: tone.cTx,
  },
  bar: {
    display: "flex",
    gap: 3,
    height: 8,
    marginTop: { default: 18, [SHORT]: 14 },
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: kl.card2,
  },
  barPart: { backgroundColor: tone.c },
  barWidth: (width: string) => ({ width }),
  summaryCounts: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    margin: "10px 0 0",
    padding: 0,
    listStyle: "none",
    fontFamily: kl.fontMono,
    fontSize: "11.5px",
    color: kl.dim,
  },
  summaryCount: { display: "flex", alignItems: "center", gap: 6 },

  /* ---------- filter bar ---------- */
  filterBar: {
    position: "sticky",
    // The fixed top bar is 82px tall (66px on phones); sit on its bottom border.
    top: { default: 81, [PHONE]: 66 },
    zIndex: 40,
    borderTop: `1px solid ${kl.bd}`,
    borderBottom: `1px solid ${kl.bd}`,
    backgroundColor: kl.glass,
    backdropFilter: kl.glassBlur,
    WebkitBackdropFilter: kl.glassBlur,
  },
  filterInner: {
    display: "flex",
    // The gutter is inside this box, so it widens by it to share the sections' edges.
    maxWidth: `calc(${kl.maxW} + 2 * ${kl.gutter})`,
    marginInline: "auto",
    alignItems: "center",
    gap: 10,
    paddingBlock: { default: 12, [PHONE]: 10 },
    paddingInline: { default: kl.gutter, [PHONE]: 14 },
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  segment: {
    display: "flex",
    flexShrink: 0,
    gap: 2,
    padding: 3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: 999,
    backgroundColor: kl.card,
  },
  button: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: 7,
    height: 34,
    borderRadius: 999,
    fontFamily: "inherit",
    fontWeight: 600,
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${kl.pink}` },
    outlineOffset: 2,
  },
  segmentBtn: {
    padding: "0 13px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: kl.dim,
    fontSize: "13.5px",
  },
  segmentOn: { backgroundColor: kl.tx, color: kl.bg },
  divider: { flexShrink: 0, width: 1, height: 22, backgroundColor: kl.bd2 },
  chips: { display: "flex", flexShrink: 0, gap: 6 },
  chip: {
    padding: "0 12px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    backgroundColor: "transparent",
    color: kl.faint,
    fontSize: 13,
  },
  chipOn: { borderColor: toneBorder, backgroundColor: toneFill, color: tone.cTx },
  chipPlannedOn: { borderColor: kl.bd2, backgroundColor: "transparent", color: kl.tx },
  spacer: { flex: 1 },
  showing: {
    flexShrink: 0,
    fontFamily: kl.fontMono,
    fontSize: "11.5px",
    whiteSpace: "nowrap",
    color: kl.faint,
  },

  /* ---------- groups ---------- */
  list: {
    paddingTop: { default: 56, [SHORT]: 40, [PHONE]: 36 },
    paddingBottom: { default: 70, [PHONE]: 40 },
    paddingInline: { default: kl.gutter, [PHONE]: 20 },
  },
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: { default: 64, [SHORT]: 48, [PHONE]: 40 },
  },
  groupHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "6px 12px",
    marginBottom: 16,
  },
  groupTitle: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    margin: 0,
    fontSize: { default: 28, [PHONE]: 22 },
    fontWeight: 700,
    letterSpacing: "-0.03em",
  },
  groupHint: { fontSize: "13.5px", color: kl.dim },
  // The header row and every row share one track list, so the cells line up.
  grid: {
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 150px 150px",
      [NARROW]: "minmax(0, 1fr) 128px 128px",
      [PHONE]: "1fr 1fr",
    },
    gap: { default: 16, [PHONE]: 12 },
  },
  // Only makes sense with columns; phones label each cell instead.
  columns: {
    display: { default: "grid", [PHONE]: "none" },
    padding: "0 20px 8px",
    fontFamily: kl.fontMono,
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: kl.faint,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "grid",
    alignItems: "center",
    padding: { default: "18px 20px", [PHONE]: 16 },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: kl.bd, ":hover": kl.bd2 },
    borderRadius: 14,
    backgroundColor: kl.card,
    transition: "border-color 0.15s",
  },
  rowMain: {
    display: "flex",
    minWidth: 0,
    alignItems: "flex-start",
    gap: 13,
    gridColumn: { default: "auto", [PHONE]: "1 / -1" },
  },
  rowIcon: {
    display: "grid",
    flexShrink: 0,
    width: 36,
    height: 36,
    marginTop: 1,
    placeItems: "center",
    borderRadius: 10,
    backgroundColor: `color-mix(in srgb, ${tint.area} 14%, transparent)`,
    color: tint.area,
  },
  rowText: { minWidth: 0 },
  rowTitleLine: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  rowTitle: { margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" },
  area: {
    padding: "2px 6px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: 4,
    fontFamily: kl.fontMono,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: kl.faint,
  },
  rowDesc: {
    margin: "4px 0 0",
    fontSize: 14,
    lineHeight: 1.5,
    color: kl.dim,
    textWrap: "pretty",
  },
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    margin: "8px 0 0",
    fontSize: "12.5px",
    lineHeight: 1.45,
    color: kl.faint,
  },
  noteIcon: { flexShrink: 0, marginTop: 2, color: palette.progressTx },
  cell: {
    display: "flex",
    flexDirection: { default: "row", [PHONE]: "column" },
    alignItems: { default: "center", [PHONE]: "flex-start" },
    justifyContent: { default: "center", [PHONE]: "flex-start" },
    gap: { default: 0, [PHONE]: 6 },
  },
  cellPlatform: {
    display: { default: "none", [PHONE]: "flex" },
    alignItems: "center",
    gap: 5,
    fontFamily: kl.fontMono,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: kl.faint,
  },
  state: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    height: 30,
    padding: "0 11px 0 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: toneBorder,
    borderRadius: 999,
    backgroundColor: toneFill,
    fontFamily: kl.fontMono,
    fontSize: "11.5px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    color: tone.cTx,
  },
  statePlanned: { borderColor: kl.bd2, backgroundColor: "transparent" },
  stateDot: {
    display: "grid",
    width: 16,
    height: 16,
    placeItems: "center",
    borderRadius: "50%",
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: tone.c,
    backgroundColor: tone.c,
    color: "#fff",
  },
  stateDotPlanned: { borderWidth: "1.5px", backgroundColor: "transparent", color: tone.cTx },

  /* ---------- legend ---------- */
  legend: {
    paddingBlock: { default: 26, [PHONE]: 22 },
    paddingInline: { default: kl.gutter, [PHONE]: 20 },
    borderTop: `1px solid ${kl.bd}`,
    backgroundColor: kl.bg2,
  },
  legendInner: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 28px" },
  legendItem: { display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: kl.dim },

  /* ---------- windows ---------- */
  windows: {
    position: "relative",
    paddingTop: { default: 110, [SHORT]: 80, [PHONE]: 60 },
    paddingBottom: { default: 100, [SHORT]: 72, [PHONE]: 60 },
    paddingInline: { default: kl.gutter, [PHONE]: 20 },
    overflow: "hidden",
  },
  windowsGlow: {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    pointerEvents: "none",
    background: `radial-gradient(45% 60% at 85% 50%, color-mix(in srgb, ${kl.c5} 14%, transparent), transparent 70%)`,
  },
  windowsInner: {
    display: "flex",
    flexDirection: { default: "row", [PHONE]: "column" },
    alignItems: { default: "center", [PHONE]: "stretch" },
    gap: { default: 60, [NARROW]: 40, [PHONE]: 26 },
  },
  windowsCopy: { flex: "1 1 0", minWidth: 0, maxWidth: { default: 520, [PHONE]: "none" } },
  windowsEyebrow: { display: "flex", alignItems: "center", gap: 10 },
  soonBadge: {
    padding: "3px 9px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${tone.c} 35%, transparent)`,
    borderRadius: 999,
    backgroundColor: toneFill,
    fontFamily: kl.fontMono,
    fontSize: "10.5px",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: tone.cTx,
  },
  h2: {
    margin: "16px 0 0",
    fontSize: "clamp(32px, 3.8vw, 54px)",
    fontWeight: 700,
    lineHeight: 0.98,
    letterSpacing: kl.trackingH2,
    textWrap: "balance",
  },
  h2Serif: {
    margin: "10px 0 0",
    fontFamily: kl.fontSerif,
    fontSize: kl.fsH2Serif,
    fontStyle: "italic",
    lineHeight: 1.1,
    color: kl.pinkTx,
  },
  windowsBody: {
    margin: "20px 0 0",
    fontSize: 16,
    lineHeight: 1.6,
    color: kl.dim,
    textWrap: "pretty",
  },
  download: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    height: 50,
    marginTop: 26,
    padding: "0 22px",
    borderRadius: 999,
    backgroundColor: kl.pink,
    boxShadow: kl.glowBtn,
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${kl.pink}` },
    outlineOffset: 2,
  },
  requirements: { margin: "14px 0 0", fontFamily: kl.fontMono, fontSize: 12, color: kl.faint },
  smartscreen: {
    flex: "1 1 0",
    minWidth: 0,
    padding: { default: 22, [PHONE]: 18 },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: 16,
    backgroundColor: kl.card,
  },
  smartscreenHead: { display: "flex", alignItems: "center", gap: 10 },
  smartscreenIcon: {
    display: "grid",
    flexShrink: 0,
    width: 34,
    height: 34,
    placeItems: "center",
    borderRadius: 10,
    backgroundColor: `color-mix(in srgb, ${tone.c} 14%, transparent)`,
    color: tone.c,
  },
  smartscreenTitle: { margin: 0, fontSize: "15.5px", fontWeight: 600 },
  smartscreenBody: { margin: "2px 0 0", fontSize: 13, color: kl.dim },
  steps: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", [NARROW]: "1fr", [PHONE]: "1fr" },
    gap: 10,
    margin: "18px 0 0",
    padding: 0,
    listStyle: "none",
  },
  step: {
    padding: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: 12,
    backgroundColor: kl.bg2,
  },
  stepHead: { display: "flex", alignItems: "center", gap: 8, fontSize: "13.5px", fontWeight: 600 },
  stepNumber: {
    display: "grid",
    flexShrink: 0,
    width: 22,
    height: 22,
    placeItems: "center",
    borderRadius: 6,
    backgroundColor: kl.c5,
    color: "#fff",
    fontFamily: kl.fontMono,
    fontSize: 11,
  },
  // Windows' own dialog colours, in both themes: this is a picture of Windows.
  mock: {
    minHeight: 64,
    marginTop: 12,
    padding: "10px 11px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgb(255 255 255 / 0.08)",
    borderRadius: 8,
    backgroundColor: "#1b2330",
  },
  mockTitle: { fontSize: 11, fontWeight: 600, color: "#e5e5e7" },
  mockText: { marginTop: 4, fontSize: 10, lineHeight: 1.4, color: "#8a93a3" },
  mockLink: { marginTop: 6, fontSize: 10, color: "#58a6ff", textDecoration: "underline" },
  mockButtons: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  mockBtn: {
    display: "inline-flex",
    alignItems: "center",
    height: 22,
    padding: "0 9px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#3b4452",
    borderRadius: 3,
    backgroundColor: "#2b3340",
    color: "#cfd6e0",
    fontSize: "10.5px",
    fontWeight: 600,
  },
  mockBtnPrimary: { borderColor: "#0067c0", backgroundColor: "#0067c0", color: "#fff" },
  mockInstall: { display: "flex", alignItems: "center", gap: 10 },
  betaNote: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    margin: "14px 0 0",
    fontSize: "12.5px",
    lineHeight: 1.5,
    color: kl.faint,
  },
});
