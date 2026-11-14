import { catalog, type CatalogState, type Step } from "../types";

const button = (name: string): Step => ({
  click: { area: "onboarding.root", part: { role: "button", name } },
});
const getStarted = button("Get started");
const continueStep = button("Continue");
// A card's accessible name starts with its title; the cards come in demo order, so the
// first substring match is the card itself ("Record" also appears in a later description).
const openDemo = (title: string): Step => ({
  click: { area: "onboarding.welcomeStep", part: { role: "button", name: title } },
});

/** From Welcome to Shortcuts. Continue on Permissions waits for screen and microphone. */
const toShortcuts: Step[] = [
  getStarted,
  { waitFor: { area: "onboarding.permissionsStep" } },
  continueStep,
  { waitFor: { area: "onboarding.shortcutsStep" } },
];

/** One state per demo: its card on Welcome, then the demo frozen by reduced motion. */
const demo = (
  id: "record" | "capture" | "share" | "editor" | "workspaces",
  title: string,
): CatalogState<"onboarding"> => ({
  profile: "onboarding",
  how: `Welcome, click the "${title}" card.`,
  steps: [openDemo(title)],
  demonstrates: [`onboarding.demo:${id}`],
  ready: { area: "onboarding.demo" },
});

/**
 * The first-run takeover over the Record page. Each state starts from a reload, which puts
 * the takeover back at Welcome (it is only stored as done when it is finished or skipped).
 * The catalog runs with animations disabled, so each demo shows its reduced-motion frame.
 */
export const onboarding = catalog("onboarding", {
  welcome: {
    profile: "onboarding",
    how: "First launch of a fresh profile.",
    demonstrates: ["onboarding.root:welcome", "onboarding.welcomeStep:default"],
  },
  "demo-record": demo("record", "Record"),
  "demo-capture": demo("capture", "Capture"),
  "demo-share": demo("share", "Edit and share"),
  "demo-editor": demo("editor", "The video editor"),
  "demo-workspaces": demo("workspaces", "Workspaces"),
  permissions: {
    profile: "onboarding",
    steps: [getStarted],
    demonstrates: ["onboarding.root:permissions", "onboarding.permissionsStep:all"],
    ready: { area: "onboarding.permissionsStep" },
    gates: [
      { permission: "screen", side: "granted" },
      { permission: "microphone", side: "granted" },
      { permission: "camera", side: "granted" },
      { permission: "accessibility", side: "granted" },
    ],
    requires: { screen: true, microphone: true, camera: true, accessibility: true },
  },
  "permissions-none": {
    profile: "onboarding",
    steps: [getStarted],
    demonstrates: ["onboarding.permissionsStep:none"],
    ready: { area: "onboarding.permissionsStep" },
    gates: [
      { permission: "screen", side: "denied" },
      { permission: "microphone", side: "denied" },
      { permission: "camera", side: "denied" },
      { permission: "accessibility", side: "denied" },
    ],
    requires: { screen: false, microphone: false, camera: false, accessibility: false },
  },
  shortcuts: {
    profile: "onboarding",
    steps: toShortcuts,
    demonstrates: ["onboarding.root:shortcuts", "onboarding.shortcutsStep:none"],
    ready: { area: "onboarding.shortcutsStep" },
    requires: { screen: true, microphone: true },
  },
  "shortcuts-tried": {
    profile: "onboarding",
    how: "Shortcuts step, then press ⇧⌘1 and ⇧⌘2 (reported without running them).",
    steps: [
      ...toShortcuts,
      { action: "reportShortcutsTried" },
      { waitFor: { area: "onboarding.shortcutsStep", part: { text: "2 OF 4 TRIED" } } },
    ],
    demonstrates: ["onboarding.shortcutsStep:someTried"],
    ready: { area: "onboarding.shortcutsStep" },
    requires: { screen: true, microphone: true },
  },
  done: {
    profile: "onboarding",
    steps: [...toShortcuts, continueStep],
    demonstrates: ["onboarding.root:done", "onboarding.doneStep:default"],
    ready: { area: "onboarding.doneStep" },
    requires: { screen: true, microphone: true },
  },
});
