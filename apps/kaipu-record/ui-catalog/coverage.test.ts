import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/shared/routes";
import {
  ALL_AREA_IDS,
  UI_MAP,
  WINDOW_KINDS,
  areaGates,
  areaStates,
  type ScreenSpec,
} from "../src/shared/ui-map";
import { CATALOGS } from "./catalog";
import { gateLabel } from "./manifest";
import { PROFILES } from "./profiles";
import { flattenCatalog, type GateSide } from "./types";

/**
 * The UI catalog's coverage check (ADR 0046). The map half: a new route, window kind or area
 * fails here with its name until `src/shared/ui-map.ts` and the renderer agree. The catalog
 * half: every map state has a catalog state that shows it, or a reason it cannot be shown,
 * and every gated area is shown on both sides of each gate.
 */

const APP = resolve(__dirname, "..");
const RENDERER = join(APP, "src/renderer");
const SCREENS = Object.entries(UI_MAP as Record<string, ScreenSpec>);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Every area literal the renderer writes: `uiArea("…")` calls and `data-ui-area="…"`. */
function rendererLiterals(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern =
    /uiArea\(\s*"([A-Za-z]+\.[A-Za-z]+)"\s*\)|data-ui-area=\{?"([A-Za-z]+\.[A-Za-z]+)"/g;
  for (const file of sourceFiles(RENDERER)) {
    if (file.endsWith("lib/ui-area.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const id = match[1] ?? match[2];
      found.set(id, [...(found.get(id) ?? []), file.slice(APP.length + 1)]);
    }
  }
  return found;
}

/** The settings children the router declares, minus the ones that only redirect. */
function settingsChildren(): { paths: string[]; redirects: string[] } {
  const router = readFileSync(join(RENDERER, "src/app/router.tsx"), "utf8");
  const start = router.indexOf("path: ROUTES.settings");
  const block = router.slice(start, router.indexOf('{ path: "*"', start));
  const paths: string[] = [];
  const redirects: string[] = [];
  for (const match of block.matchAll(/path:\s*"([^"]+)",\s*element:\s*(<Navigate\b)?/g)) {
    (match[2] ? redirects : paths).push(match[1]);
  }
  return { paths, redirects };
}

describe("ui-map coverage", () => {
  it("has a screen for every ROUTES entry", () => {
    const covered = new Set(
      SCREENS.flatMap(([, s]) => (s.kind === "route" && s.route ? [s.route as string] : [])),
    );
    const missing = Object.entries(ROUTES)
      .filter(([, path]) => !covered.has(path))
      .map(([name]) => name);
    expect(missing, "ROUTES entries with no screen (or redirect/notCapturable)").toEqual([]);
  });

  it("has a window screen for every WINDOW_KINDS entry", () => {
    const covered = new Set(SCREENS.flatMap(([, s]) => (s.kind === "window" ? [s.window] : [])));
    expect(WINDOW_KINDS.filter((kind) => !covered.has(kind))).toEqual([]);
  });

  it("has a screen for every Settings child route in the router", () => {
    const { paths } = settingsChildren();
    expect(paths.length).toBeGreaterThan(0);
    const covered = new Set(
      SCREENS.flatMap(([, s]) => (s.kind === "route" ? [s.route as string] : [])),
    );
    const missing = paths.filter((p) => !covered.has(`/settings/${p}`));
    expect(missing, "settings children with no screen").toEqual([]);
  });

  it("gives every capturable screen an area", () => {
    const empty = SCREENS.filter(([, s]) => {
      if ("redirect" in s || "notCapturable" in s) return false;
      return Object.keys(s.areas).length === 0;
    }).map(([id]) => id);
    expect(empty).toEqual([]);
  });

  it("gives every area a state", () => {
    expect(ALL_AREA_IDS.filter((id) => areaStates(id).length === 0)).toEqual([]);
  });

  it("only writes area literals the map declares", () => {
    const declared = new Set<string>(ALL_AREA_IDS);
    const unknown = [...rendererLiterals()].filter(([id]) => !declared.has(id));
    expect(unknown.map(([id, files]) => `${id} (${files[0]})`)).toEqual([]);
  });

  it("annotates every declared area somewhere in the renderer", () => {
    const written = rendererLiterals();
    expect(ALL_AREA_IDS.filter((id) => !written.has(id))).toEqual([]);
  });
});

const ENTRIES = flattenCatalog(CATALOGS);
const MAP_STATES = new Set(
  ALL_AREA_IDS.flatMap((area) => areaStates(area).map((st) => `${area}:${st}`)),
);

/** `{ screen: [missing, …] }`, so a failure reads as a to-do list per screen. */
function byScreen(ids: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const id of ids) (grouped[id.split(".")[0]] ??= []).push(id);
  return grouped;
}

describe("ui catalog coverage", () => {
  it("shows every map state, or says why it cannot", () => {
    const shown = new Set(ENTRIES.flatMap((e) => e.spec.demonstrates as readonly string[]));
    const declared = new Set(CATALOGS.flatMap((c) => Object.keys(c.notCapturable)));
    const missing = [...MAP_STATES].filter((id) => !shown.has(id) && !declared.has(id));
    expect(
      byScreen(missing),
      "map states with no catalog state and no notCapturable reason, by screen",
    ).toEqual({});
  });

  it("names only map states and areas", () => {
    const unknown = [
      ...ENTRIES.flatMap((e) =>
        (e.spec.demonstrates as readonly string[])
          .filter((id) => !MAP_STATES.has(id))
          .map((id) => `${e.id} demonstrates ${id}`),
      ),
      ...CATALOGS.flatMap((c) =>
        Object.keys(c.notCapturable)
          .filter((id) => !MAP_STATES.has(id))
          .map((id) => `${c.screen} declares ${id}`),
      ),
      ...CATALOGS.flatMap((c) =>
        Object.keys(c.oneSided)
          .filter((id) => !(ALL_AREA_IDS as readonly string[]).includes(id))
          .map((id) => `${c.screen} oneSided ${id}`),
      ),
    ];
    expect(unknown).toEqual([]);
  });

  it("keeps each state on its own screen and a known profile", () => {
    const wrong = ENTRIES.flatMap((e) => [
      ...(e.spec.demonstrates as readonly string[])
        .filter((id) => !id.startsWith(`${e.screen}.`))
        .map((id) => `${e.id} demonstrates ${id} of another screen`),
      ...(e.spec.profile in PROFILES ? [] : [`${e.id} uses unknown profile ${e.spec.profile}`]),
      ...(e.spec.window && UI_MAP[e.screen].kind !== "route"
        ? [`${e.id} resizes a window that is not a route`]
        : []),
    ]);
    expect(wrong).toEqual([]);
    expect(new Set(CATALOGS.map((c) => c.screen)).size).toBe(CATALOGS.length);
  });

  it("shows every gated area on both sides of each gate", () => {
    const gaps: string[] = [];
    for (const area of ALL_AREA_IDS) {
      const screen = area.split(".")[0];
      const cat = CATALOGS.find((c) => c.screen === screen);
      if (cat && area in cat.oneSided) continue;
      // An area whose every state is declared not capturable has no side to show.
      if (cat && areaStates(area).every((st) => `${area}:${st}` in cat.notCapturable)) continue;
      const states = ENTRIES.filter((e) => e.screen === screen);
      for (const gate of areaGates(area)) {
        const label = gateLabel(gate);
        const sides = new Set(
          states.flatMap((e) =>
            (e.spec.gates ?? [])
              .filter((g: GateSide) => gateLabel(g) === label)
              .map((g: GateSide) => g.side),
          ),
        );
        if (sides.size < 2)
          gaps.push(`${area}: ${label} (sides: ${[...sides].join(", ") || "none"})`);
      }
    }
    expect(byScreen(gaps), "gated areas missing a side (add a state or a oneSided reason)").toEqual(
      {},
    );
  });

  it("shoots every onboarding demo state in reduced motion, and no other state", () => {
    const flagged = ENTRIES.filter((e) => e.spec.reducedMotion).map((e) => e.id);
    const demos = ENTRIES.filter((e) => e.id.startsWith("onboarding/demo-")).map((e) => e.id);
    expect(demos.length).toBeGreaterThan(0);
    expect(flagged).toEqual(demos);
  });
});
