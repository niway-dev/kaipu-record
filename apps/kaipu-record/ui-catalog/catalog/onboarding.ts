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

/** From Welcome to Privacy: the shortcuts step's Continue. */
const toPrivacy: Step[] = [
  ...toShortcuts,
  continueStep,
  { waitFor: { area: "onboarding.privacyStep" } },
];

/** From Welcome to Transcription, which exists only while the speech model is on offer. */
const toTranscription: Step[] = [
  ...toShortcuts,
  continueStep,
  { waitFor: { area: "onboarding.transcriptionStep" } },
];

/**
 * One state per demo: its card on Welcome, then the demo frozen by reduced motion. The runner
 * emulates `prefers-reduced-motion: reduce` for it (`reducedMotion`) and shoots it with
 * animations allowed, because "disabled" would cancel the paused animation that holds the frame.
 */
const demo = (
  id: "record" | "capture" | "share" | "editor" | "workspaces",
  title: string,
): CatalogState<"onboarding"> => ({
  profile: "onboarding",
  how: `Welcome, click the "${title}" card.`,
  steps: [openDemo(title)],
  reducedMotion: true,
  demonstrates: [`onboarding.demo:${id}`],
  ready: { area: "onboarding.demo" },
});

/**
 * The first-run takeover over the Record page. Each state starts from a reload, which puts
 * the takeover back at Welcome (it is only stored as done when it is finished or skipped).
 * Only the demo states run in reduced motion; the others keep the catalog's default of
 * animations disabled in the shot.
 */
export const onboarding = catalog(
  "onboarding",
  {
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
    transcription: {
      profile: "onboarding-transcription-missing",
      how: "Shortcuts, Continue: the offer to download the speech model (flag on, model not installed).",
      steps: toTranscription,
      demonstrates: ["onboarding.root:transcription", "onboarding.transcriptionStep:offer"],
      ready: { area: "onboarding.transcriptionStep" },
      gates: [{ flag: "transcription", side: "on" }],
      requires: { screen: true, microphone: true },
    },
    privacy: {
      profile: "onboarding",
      how: "Shortcuts step, Continue. The share-usage toggle is on, as it is for a new user.",
      steps: toPrivacy,
      demonstrates: ["onboarding.root:privacy", "onboarding.privacyStep:on"],
      ready: { area: "onboarding.privacyStep" },
      requires: { screen: true, microphone: true },
    },
    "privacy-off": {
      profile: "onboarding",
      how: "Privacy step, then switch Share usage and crash reports off.",
      steps: [
        ...toPrivacy,
        {
          click: {
            area: "onboarding.privacyStep",
            part: { role: "switch", name: "Share usage and crash reports" },
          },
        },
      ],
      demonstrates: ["onboarding.privacyStep:off"],
      ready: { area: "onboarding.privacyStep" },
      requires: { screen: true, microphone: true },
    },
    "privacy-notice": {
      profile: "privacy-notice",
      how: "A Mac that finished onboarding before the step existed, on its next launch.",
      demonstrates: ["onboarding.privacyNotice:default"],
      ready: { area: "onboarding.privacyNotice" },
    },
    done: {
      profile: "onboarding",
      steps: [...toPrivacy, continueStep],
      demonstrates: ["onboarding.root:done", "onboarding.doneStep:default"],
      ready: { area: "onboarding.doneStep" },
      requires: { screen: true, microphone: true },
    },
  },
  {
    oneSided: {
      "onboarding.transcriptionStep":
        "with the flag off, or no model to offer, the step is not in the flow, so it has no look of its own",
    },
  },
);
