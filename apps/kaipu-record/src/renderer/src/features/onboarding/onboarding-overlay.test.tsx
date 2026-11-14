import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as i18n from "@kaipu/i18n";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import { type KaipuElectronAPI, type PermissionStatus, type ShortcutAction } from "@shared/types";
import { OnboardingOverlay } from "./onboarding-overlay";

/** What main would send on `shortcut:fired`: every listener the overlay registered. */
const shortcutListeners = new Set<(action: ShortcutAction) => void>();
function pressGlobalShortcut(action: ShortcutAction): void {
  act(() => shortcutListeners.forEach((listener) => listener(action)));
}

const granted = { screen: true, microphone: true, camera: false };

function mockElectronAPI(overrides: Partial<KaipuElectronAPI> = {}): {
  checkPermissions: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  openSystemSettings: ReturnType<typeof vi.fn>;
  getAccessibilityStatus: ReturnType<typeof vi.fn>;
  requestAccessibility: ReturnType<typeof vi.fn>;
  requestRecordSelector: ReturnType<typeof vi.fn>;
  requestCaptureScreenshot: ReturnType<typeof vi.fn>;
} {
  const allDenied: PermissionStatus = { screen: false, microphone: false, camera: false };
  // Built as one object, `overrides` applied last, so the returned mocks below are
  // always the EFFECTIVE ones actually wired to window.electronAPI — a caller that
  // overrides e.g. requestAccessibility must get its own mock back, not a default one
  // that was shadowed by the spread and never actually called.
  const api = {
    getScreenSources: vi.fn(),
    resizeCapturePanel: vi.fn(),
    openMainWindow: vi.fn(),
    checkPermissions: vi.fn().mockResolvedValue(allDenied),
    requestPermission: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(undefined),
    // Default "not-required": every existing test in this file exercises non-mac /
    // already-decided flows, where the Accessibility row must stay absent.
    getAccessibilityStatus: vi.fn().mockResolvedValue("not-required"),
    requestAccessibility: vi.fn().mockResolvedValue("not-required"),
    // The overlay raises the window's minimum size while it is mounted.
    setOnboardingWindowMode: vi.fn(),
    // The Done step reads the live start-recording binding.
    getSettings: vi.fn().mockResolvedValue({ shortcuts: defaultShortcutsFor("darwin") }),
    onSettingsChanged: vi.fn(() => () => {}),
    // The Shortcuts step listens for presses main reports.
    onShortcutFired: vi.fn((callback: (action: ShortcutAction) => void) => {
      shortcutListeners.add(callback);
      return () => shortcutListeners.delete(callback);
    }),
    requestRecordSelector: vi.fn(),
    requestCaptureScreenshot: vi.fn(),
    ...overrides,
  } as unknown as KaipuElectronAPI;
  window.electronAPI = api;
  return {
    checkPermissions: api.checkPermissions as ReturnType<typeof vi.fn>,
    requestPermission: api.requestPermission as ReturnType<typeof vi.fn>,
    openSystemSettings: api.openSystemSettings as ReturnType<typeof vi.fn>,
    getAccessibilityStatus: api.getAccessibilityStatus as ReturnType<typeof vi.fn>,
    requestAccessibility: api.requestAccessibility as ReturnType<typeof vi.fn>,
    requestRecordSelector: api.requestRecordSelector as ReturnType<typeof vi.fn>,
    requestCaptureScreenshot: api.requestCaptureScreenshot as ReturnType<typeof vi.fn>,
  };
}

async function toPermissions(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /get started/i }));
  await screen.findByRole("heading", { name: /let kaipu see and hear/i });
}

async function toShortcuts(): Promise<void> {
  await toPermissions();
  await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByRole("heading", { name: /four shortcuts are the whole app/i });
}

async function toDone(): Promise<void> {
  await toShortcuts();
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByRole("heading", { name: /you're set/i });
}

describe("OnboardingOverlay", () => {
  beforeEach(() => {
    shortcutListeners.clear();
    mockElectronAPI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts on Welcome with the five feature cards", () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /welcome to kaipu/i })).toBeInTheDocument();
    for (const title of ["Record", "Capture", "Edit and share", "The video editor", "Workspaces"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText("WELCOME")).toBeInTheDocument();
  });

  it("plays a card's demo in place; All features and Esc go back to the cards", () => {
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    fireEvent.click(screen.getByText("The video editor"));
    expect(screen.getByRole("button", { name: "The video editor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByRole("button", { name: "Workspaces" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /all features/i }));
    expect(screen.queryByRole("group", { name: "Feature demos" })).toBeNull();

    fireEvent.click(screen.getByText("Capture"));
    expect(screen.getByRole("group", { name: "Feature demos" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Feature demos" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Skip to permissions on Welcome goes to Permissions, not out", async () => {
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /skip to permissions/i }));
    expect(await screen.findByRole("heading", { name: /let kaipu see and hear/i })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks on Permissions until screen and microphone are granted", async () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    // No way around it: the skip link is only an explanation, and the dots ahead are off.
    expect(screen.getByText(/screen and microphone are needed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip the tour/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to step 3" })).toBeDisabled();

    const grantButtons = screen.getAllByRole("button", { name: /^grant$/i });
    fireEvent.click(grantButtons[0]); // screen
    fireEvent.click(grantButtons[1]); // microphone

    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /skip the tour/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to step 3" })).toBeEnabled();
  });

  it("shows Requesting… while the OS has not answered a grant", async () => {
    let answer: (granted: boolean) => void = () => {};
    mockElectronAPI({
      requestPermission: vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve))),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    fireEvent.click(screen.getAllByRole("button", { name: /^grant$/i })[0]);
    expect(await screen.findByText("Requesting…")).toBeInTheDocument();
    await act(async () => answer(true));
    expect(screen.queryByText("Requesting…")).toBeNull();
    expect(screen.getByText("GRANTED")).toBeInTheDocument();
  });

  it("offers Open Settings for a permission the OS already denied", async () => {
    const { openSystemSettings } = mockElectronAPI({
      requestPermission: vi.fn().mockResolvedValue(false),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    fireEvent.click(screen.getAllByRole("button", { name: /^grant$/i })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /open settings/i }));
    expect(openSystemSettings).toHaveBeenCalledWith("screen");
  });

  it("says why each permission is needed in one line under its name", async () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    expect(screen.getByText("To record and capture what is on your screen.")).toBeInTheDocument();
    expect(screen.getByText("To record your voice with the screen.")).toBeInTheDocument();
    expect(screen.getByText("To add your face in a bubble.")).toBeInTheDocument();
  });

  it("draws each shortcut from the live bindings, one keycap per key", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    const { container } = render(<OnboardingOverlay onClose={vi.fn()} />);
    await toShortcuts();
    const capture = await waitFor(() => {
      const card = container.querySelector('[data-shortcut="captureScreenshot"]');
      expect(card?.querySelectorAll("kbd")).toHaveLength(3);
      return card as HTMLElement;
    });
    expect([...capture.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["⇧", "⌘", "1"]);
    // Window capture is not one of the four.
    expect(container.querySelector('[data-shortcut="captureWindow"]')).toBeNull();
  });

  it("marks a shortcut tried only when main reports a real press, and counts them", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    const { container } = render(<OnboardingOverlay onClose={vi.fn()} />);
    await toShortcuts();
    expect(screen.getByText("0 OF 4 TRIED · OPTIONAL")).toBeInTheDocument();

    // A click on a card is not a press.
    fireEvent.click(screen.getByText("Capture"));
    expect(screen.getByText("0 OF 4 TRIED · OPTIONAL")).toBeInTheDocument();

    pressGlobalShortcut("captureScreenshot");
    pressGlobalShortcut("captureScreenshot");
    pressGlobalShortcut("captureWindow"); // not one of the four
    expect(screen.getByText("1 OF 4 TRIED · OPTIONAL")).toBeInTheDocument();
    expect(
      container.querySelector('[data-shortcut="captureScreenshot"]')?.getAttribute("data-tried"),
    ).toBe("true");

    pressGlobalShortcut("startRecording");
    pressGlobalShortcut("captureInstant");
    pressGlobalShortcut("bringToFront");
    expect(screen.getByText("ALL FOUR TRIED")).toBeInTheDocument();
  });

  it("does not count a press made on another step", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    pressGlobalShortcut("captureScreenshot");
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("0 OF 4 TRIED · OPTIONAL")).toBeInTheDocument();
  });

  it("Continue stays on for Shortcuts, and Skip the tour closes", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    await toShortcuts();
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /skip the tour/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("You're set: Record something closes, then opens the capture widget to record", async () => {
    const { requestRecordSelector, requestCaptureScreenshot } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue(granted),
    });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    await toDone();

    // No Continue and no skip link on the last step: its own buttons are the ways out.
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    // The shortcut hints are the live bindings, not the old ⌘⇧P literal.
    expect(await screen.findByText("⇧⌘2")).toBeInTheDocument();
    expect(screen.getByText("⇧⌘1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /record something/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(requestRecordSelector).toHaveBeenCalledOnce();
    expect(requestCaptureScreenshot).not.toHaveBeenCalled();
  });

  it("You're set: Take a screenshot lets main pick the mode, as the shortcut does", async () => {
    const { requestCaptureScreenshot } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue(granted),
    });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    await toDone();
    fireEvent.click(screen.getByRole("button", { name: /take a screenshot/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(requestCaptureScreenshot).toHaveBeenCalledWith();
  });

  it("a dot jumps back to an earlier step", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: "Go to step 1" }));
    expect(screen.getByRole("heading", { name: /welcome to kaipu/i })).toBeInTheDocument();
  });

  it("Enter on a focused card button does not advance the step", () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    const card = screen.getByText("Workspaces").closest("button") as HTMLButtonElement;
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByRole("heading", { name: /welcome to kaipu/i })).toBeInTheDocument();
  });

  it("speaks Windows on Windows: no macOS wording, glyphs or menu bar from welcome to done", async () => {
    mockElectronAPI({
      platform: "win32",
      checkPermissions: vi.fn().mockResolvedValue(granted),
      getSettings: vi.fn().mockResolvedValue({ shortcuts: defaultShortcutsFor("win32") }),
    } as Partial<KaipuElectronAPI>);
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    expect(screen.getByText(/Windows asks once/)).toBeInTheDocument();
    expect(screen.queryByText(/macOS/)).toBeNull();

    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/back from the system tray/)).toBeInTheDocument();
    expect(screen.queryByText(/⌘|⌃|menu bar/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("Ctrl+Alt+2")).toBeInTheDocument();
    expect(screen.getByText("System tray")).toBeInTheDocument();
    expect(screen.queryByText(/⌘|⌃|menu bar/)).toBeNull();
  });
});

describe("OnboardingOverlay — Accessibility row", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is absent while the OS reports it as not required (non-mac)", async () => {
    mockElectronAPI({ checkPermissions: vi.fn().mockResolvedValue(granted) });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    expect(screen.queryByText("Accessibility")).toBeNull();
  });

  it("is an optional row whose Allow calls requestAccessibility() and never gates Continue", async () => {
    const { requestAccessibility } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue(granted),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
      requestAccessibility: vi.fn().mockResolvedValue("denied"),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();

    expect(await screen.findByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByText("To know where you click, so zooms land on it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    expect(requestAccessibility).toHaveBeenCalledOnce();

    // Still denied after the prompt: the button comes back, Continue is still enabled.
    expect(await screen.findByRole("button", { name: /^allow$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", { name: /four shortcuts are the whole app/i }),
    ).toBeInTheDocument();
  });

  it("keeps the privacy and restart detail behind its (i)", async () => {
    mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue(granted),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    await screen.findByText("Accessibility");
    expect(screen.queryByText(/never the keyboard/i)).toBeNull();
    fireEvent.click(screen.getByRole("img", { name: /why accessibility\?/i }));
    expect(screen.getByText(/never the keyboard/i)).toBeInTheDocument();
  });

  it("flips the row to GRANTED when the permission is granted outside the app (re-read on focus)", async () => {
    const { getAccessibilityStatus } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue(granted),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toPermissions();
    await screen.findByRole("button", { name: /^allow$/i });

    // The user alt-tabs to System Settings, grants it, and comes back.
    getAccessibilityStatus.mockResolvedValue("granted");
    fireEvent.focus(window);

    await waitFor(() => expect(screen.queryByRole("button", { name: /^allow$/i })).toBeNull());
    // Still on the permissions step: nothing moved under the user.
    expect(screen.getByRole("heading", { name: /let kaipu see and hear/i })).toBeInTheDocument();
  });
});

describe("OnboardingOverlay — language picker on the welcome step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers every locale by its own name, marks the active one, and switches via the provider", () => {
    mockElectronAPI();
    // setup.ts stubs `useSetLocale` with a no-op; swap in a spy to assert the write.
    const setLocale = vi.fn();
    vi.spyOn(i18n, "useSetLocale").mockReturnValue(setLocale);
    render(<OnboardingOverlay onClose={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: /language/i });
    const es = within(group).getByRole("radio", { name: "Español" });
    const en = within(group).getByRole("radio", { name: "English" });
    // The test setup stubs useLocale to "en".
    expect(en).toHaveAttribute("aria-checked", "true");
    expect(es).toHaveAttribute("aria-checked", "false");

    fireEvent.click(es);
    expect(setLocale).toHaveBeenCalledWith("es");
  });
});
