/**
 * Lists the on-screen windows for Window mode without a native module (ADR 0024, decision 1).
 *
 * - macOS: `osascript -l JavaScript` calling `CGWindowListCopyWindowInfo`; bounds are global
 *   points, which are already DIP.
 * - Windows: a PowerShell script over `EnumWindows` and `DwmGetWindowAttribute`; bounds are
 *   physical pixels and are converted with `screen.screenToDipRect`.
 *
 * Both scripts are string constants in this module, never files on disk. The pure
 * `toListedWindows` filters, converts and assigns displays; tests feed it fake raw lists and
 * inject `runCommand`, so no test ever spawns a process.
 */

import { execFile } from "node:child_process";
import type { Display } from "electron";
import type { CaptureRect, ListedWindow } from "@shared/types/screenshot-capture";
import type { DisplayLike } from "./capture-geometry";

/** One window as the OS tool reports it, before filtering. */
export interface RawWindow {
  /** macOS CGWindowID or Windows HWND, as a decimal string. */
  id: string;
  title: string;
  ownerName: string;
  pid: number;
  /** Global. Points (DIP) on macOS, PHYSICAL pixels on Windows. */
  bounds: CaptureRect;
  /** macOS `kCGWindowLayer`; normal app windows are 0. */
  layer?: number;
  /** Windows `GWL_EXSTYLE`. */
  exStyle?: number;
  /** Windows `DWMWA_CLOAKED` is non-zero (another virtual desktop, suspended UWP app, …). */
  cloaked?: boolean;
  /** Windows `IsWindowVisible`. */
  visible?: boolean;
}

export interface WindowLister {
  /** Never rejects: a failure or a timeout answers `[]`. */
  list(displays: Display[]): Promise<ListedWindow[]>;
}

/** What belongs to this app and must never be listed. */
export interface SelfWindows {
  pids: number[];
  /** Native window handles as decimal strings. Windows only; see `decodeNativeWindowHandle`. */
  handles: string[];
}

export type RunCommand = (
  cmd: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<string>;

export interface ListerDeps {
  runCommand: RunCommand;
  getSelf: () => Promise<SelfWindows>;
}

export interface WindowsListerDeps extends ListerDeps {
  /** Physical → DIP. Default: `screen.screenToDipRect(null, rect)`, loaded lazily. */
  screenToDip?: (rect: CaptureRect) => CaptureRect;
}

/**
 * A list slower than this is abandoned: the overlay shows "no windows", not a stuck hint.
 * macOS: osascript answers in ~50 ms (measured), so 2 s is a wide margin.
 */
export const MAC_WINDOW_LIST_TIMEOUT_MS = 2000;
/**
 * Windows: PowerShell compiles the C# with `Add-Type` on every run. The spec estimates
 * 300–800 ms cold and names 800 ms as the gate for replacing the script with a native
 * module (open question 1); NEITHER number has been measured on a Windows machine yet.
 * A cold start on a slow disk or under Defender scanning can take several seconds, so the
 * cut-off is 6 s: long enough not to throw away a slow but working list, while the overlay
 * stays usable in Frame and Screen the whole time.
 */
export const WINDOWS_WINDOW_LIST_TIMEOUT_MS = 6000;

/** The lister's timeout on `platform`. */
export function windowListTimeoutMs(platform: NodeJS.Platform): number {
  return platform === "win32" ? WINDOWS_WINDOW_LIST_TIMEOUT_MS : MAC_WINDOW_LIST_TIMEOUT_MS;
}
/** Windows smaller than this, in DIP, in either dimension, are not offered. */
export const MIN_WINDOW_SIZE_DIP = 50;
const WS_EX_TOOLWINDOW = 0x80;
const MAX_BUFFER = 4 * 1024 * 1024;
const LOG = "[window-lister]";

// ---------------------------------------------------------------------------
// Pure filter and conversion
// ---------------------------------------------------------------------------

/**
 * Filters raw windows and turns them into what the overlay sees. Drops our own pids and
 * handles, tool, cloaked and invisible windows, non-zero layers, and anything under 50 × 50
 * DIP. `displayId` is the display holding the window's centre (else the largest overlap, else
 * the primary); `rect` is display-relative DIP clamped to that display, `fullSize` the
 * unclamped DIP size. A window that lands on
 * no display at all clamps to nothing and is dropped. Order is preserved: front first.
 */
export function toListedWindows(
  raw: RawWindow[],
  displays: DisplayLike[],
  self: SelfWindows,
  toDip: (rect: CaptureRect) => CaptureRect = (rect) => rect,
): ListedWindow[] {
  if (displays.length === 0) return [];
  const pids = new Set(self.pids);
  const handles = new Set(self.handles);
  const listed: ListedWindow[] = [];

  for (const window of raw) {
    if (pids.has(window.pid) || handles.has(window.id)) continue;
    if (window.layer !== undefined && window.layer !== 0) continue;
    if (window.exStyle !== undefined && (window.exStyle & WS_EX_TOOLWINDOW) !== 0) continue;
    if (window.cloaked === true || window.visible === false) continue;

    const bounds = toDip(window.bounds);
    if (bounds.width < MIN_WINDOW_SIZE_DIP || bounds.height < MIN_WINDOW_SIZE_DIP) continue;

    const display = displayFor(bounds, displays);
    const clipped = intersect(bounds, display.bounds);
    if (clipped.width <= 0 || clipped.height <= 0) continue;

    listed.push({
      id: window.id,
      title: window.title || window.ownerName,
      ownerName: window.ownerName,
      displayId: display.id,
      rect: {
        x: clipped.x - display.bounds.x,
        y: clipped.y - display.bounds.y,
        width: clipped.width,
        height: clipped.height,
      },
      fullSize: { width: bounds.width, height: bounds.height },
    });
  }
  return listed;
}

function displayFor(rect: CaptureRect, displays: DisplayLike[]): DisplayLike {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const holding = displays.find(
    ({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height,
  );
  if (holding) return holding;

  let best: DisplayLike | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const overlap = intersect(rect, display.bounds);
    const area = Math.max(overlap.width, 0) * Math.max(overlap.height, 0);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return best ?? primaryOf(displays);
}

/** Electron puts the primary display's origin at (0, 0) on both macOS and Windows. */
function primaryOf(displays: DisplayLike[]): DisplayLike {
  return displays.find((d) => d.bounds.x === 0 && d.bounds.y === 0) ?? (displays[0] as DisplayLike);
}

function intersect(a: CaptureRect, b: CaptureRect): CaptureRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parses the JXA output (one JSON array). Throws when the output is not an array at all. */
export function parseMacWindowList(stdout: string): RawWindow[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("window list is not a JSON array");
  return parsed.flatMap((entry) => {
    const window = toRawWindow(entry);
    return window ? [window] : [];
  });
}

/** Parses the PowerShell output: one JSON object per line. Malformed lines are skipped. */
export function parseWindowsWindowLines(stdout: string): RawWindow[] {
  const windows: RawWindow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const window = toRawWindow(JSON.parse(trimmed));
      if (window) windows.push(window);
    } catch {
      // A line PowerShell printed that is not ours; the rest of the list still counts.
    }
  }
  return windows;
}

function toRawWindow(value: unknown): RawWindow | null {
  if (!isRecord(value)) return null;
  const { id, title, ownerName, pid, bounds, layer, exStyle, cloaked, visible } = value;
  if (typeof id !== "string" || id === "" || !isFiniteNumber(pid)) return null;
  if (!isRecord(bounds)) return null;
  const { x, y, width, height } = bounds;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  const window: RawWindow = {
    id,
    title: typeof title === "string" ? title : "",
    ownerName: typeof ownerName === "string" ? ownerName : "",
    pid,
    bounds: { x, y, width, height },
  };
  if (isFiniteNumber(layer)) window.layer = layer;
  if (isFiniteNumber(exStyle)) window.exStyle = exStyle;
  if (typeof cloaked === "boolean") window.cloaked = cloaked;
  if (typeof visible === "boolean") window.visible = visible;
  return window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/**
 * JXA over CoreGraphics. Verified on the development Mac, 2026-10-17: ~30 ms inside a ~50 ms
 * `osascript` process. `kCGWindowName` of other apps is only filled with Screen Recording
 * permission, and TCC attribution of this child process is unverified (spec open question 2);
 * the title falls back to the owner name.
 */
export const MAC_WINDOW_LIST_SCRIPT = [
  'ObjC.import("CoreGraphics");',
  "const ref = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0);",
  "const list = ObjC.deepUnwrap(ObjC.castRefToObject(ref));",
  "JSON.stringify(list.map(w => ({",
  "  id: String(w.kCGWindowNumber),",
  '  title: w.kCGWindowName || "",',
  '  ownerName: w.kCGWindowOwnerName || "",',
  "  pid: w.kCGWindowOwnerPID,",
  "  layer: w.kCGWindowLayer,",
  "  bounds: { x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height }",
  "})))",
].join("\n");

/**
 * PowerShell + C# P/Invoke. NOT run on a Windows machine yet (blocked by the Windows build);
 * written for Windows PowerShell 5.1, whose `Add-Type` compiles C# 5 (no `out var`, no
 * interpolation). Notes:
 * - The thread is made per-monitor DPI aware first, so `GetWindowRect` (the fallback) answers
 *   physical pixels like `DWMWA_EXTENDED_FRAME_BOUNDS` does; a DPI-unaware PowerShell would
 *   otherwise get virtualised coordinates from it on a scaled display.
 * - Invisible windows are skipped inside the script (there are hundreds); tool and cloaked
 *   windows are reported and dropped by `toListedWindows`, so the rule lives in tested code.
 * - Output is UTF-8, one compressed JSON object per line, `id` = decimal HWND (the same number
 *   `desktopCapturer` puts in `window:<hwnd>:0`).
 */
export const WINDOWS_WINDOW_LIST_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class KaipuWindowList {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public sealed class Info {
    public string Id; public string Title; public string OwnerName; public int Pid;
    public long ExStyle; public bool Cloaked; public int X; public int Y; public int Width; public int Height;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  public static List<Info> List() {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    List<Info> result = new List<Info>();
    Dictionary<uint, string> owners = new Dictionary<uint, string>();
    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;

      int length = GetWindowTextLengthW(hWnd);
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowTextW(hWnd, text, text.Capacity);

      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      string owner;
      if (!owners.TryGetValue(pid, out owner)) {
        try { owner = Process.GetProcessById((int)pid).ProcessName; } catch { owner = ""; }
        owners[pid] = owner;
      }

      long exStyle = IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE).ToInt64() : GetWindowLong32(hWnd, GWL_EXSTYLE);

      int cloaked;
      bool isCloaked = DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;

      RECT rect;
      if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) != 0) {
        if (!GetWindowRect(hWnd, out rect)) return true;
      }

      Info info = new Info();
      info.Id = hWnd.ToInt64().ToString();
      info.Title = text.ToString();
      info.OwnerName = owner;
      info.Pid = (int)pid;
      info.ExStyle = exStyle;
      info.Cloaked = isCloaked;
      info.X = rect.Left;
      info.Y = rect.Top;
      info.Width = rect.Right - rect.Left;
      info.Height = rect.Bottom - rect.Top;
      result.Add(info);
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
foreach ($w in [KaipuWindowList]::List()) {
  [pscustomobject]@{
    id = $w.Id; title = $w.Title; ownerName = $w.OwnerName; pid = $w.Pid
    exStyle = $w.ExStyle; cloaked = $w.Cloaked; visible = $true
    bounds = [pscustomobject]@{ x = $w.X; y = $w.Y; width = $w.Width; height = $w.Height }
  } | ConvertTo-Json -Compress
}
`;

// ---------------------------------------------------------------------------
// Listers
// ---------------------------------------------------------------------------

abstract class ScriptWindowLister implements WindowLister {
  protected abstract readonly label: string;
  protected abstract readonly cmd: string;
  protected abstract readonly args: string[];
  protected abstract readonly timeoutMs: number;
  protected abstract parse(stdout: string): RawWindow[];
  protected abstract toDip(): Promise<((rect: CaptureRect) => CaptureRect) | undefined>;

  constructor(private readonly deps: ListerDeps) {}

  async list(displays: Display[]): Promise<ListedWindow[]> {
    const started = performance.now();
    try {
      const run = async () => {
        const [stdout, self] = await Promise.all([
          this.deps.runCommand(this.cmd, this.args, { timeoutMs: this.timeoutMs }),
          this.deps.getSelf(),
        ]);
        return toListedWindows(this.parse(stdout), displays, self, await this.toDip());
      };
      const listed = await withTimeout(run(), this.timeoutMs);
      console.debug(
        `${LOG} ${this.label}: ${listed.length} windows in ${Math.round(performance.now() - started)} ms`,
      );
      return listed;
    } catch (error) {
      console.warn(
        `${LOG} ${this.label} listing failed after ${Math.round(performance.now() - started)} ms`,
        error,
      );
      return [];
    }
  }
}

export class MacWindowLister extends ScriptWindowLister {
  protected readonly label = "macOS";
  protected readonly cmd = "osascript";
  protected readonly args = ["-l", "JavaScript", "-e", MAC_WINDOW_LIST_SCRIPT];
  protected readonly timeoutMs = windowListTimeoutMs("darwin");

  constructor(deps: ListerDeps = defaultDeps) {
    super(deps);
  }

  protected parse(stdout: string): RawWindow[] {
    return parseMacWindowList(stdout);
  }

  /** CoreGraphics bounds are global points, which are DIP already. */
  protected async toDip(): Promise<undefined> {
    return undefined;
  }
}

export class WindowsWindowLister extends ScriptWindowLister {
  protected readonly label = "Windows";
  protected readonly cmd = "powershell";
  protected readonly timeoutMs = windowListTimeoutMs("win32");
  // -EncodedCommand (base64 of UTF-16LE) instead of -Command: the script is full of quotes,
  // and Windows command-line quoting between Node and powershell.exe would mangle some of them.
  protected readonly args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(WINDOWS_WINDOW_LIST_SCRIPT, "utf16le").toString("base64"),
  ];

  constructor(private readonly windowsDeps: WindowsListerDeps = defaultDeps) {
    super(windowsDeps);
  }

  protected parse(stdout: string): RawWindow[] {
    return parseWindowsWindowLines(stdout);
  }

  protected async toDip(): Promise<(rect: CaptureRect) => CaptureRect> {
    if (this.windowsDeps.screenToDip) return this.windowsDeps.screenToDip;
    const { screen } = await import("electron");
    return (rect) => screen.screenToDipRect(null, rect);
  }
}

export class NoopWindowLister implements WindowLister {
  async list(): Promise<ListedWindow[]> {
    return [];
  }
}

export function createWindowLister(platform: NodeJS.Platform = process.platform): WindowLister {
  if (platform === "darwin") return new MacWindowLister();
  if (platform === "win32") return new WindowsWindowLister();
  return new NoopWindowLister();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Our own windows
// ---------------------------------------------------------------------------

/**
 * The decimal handle of one of our windows as the OS lister reports it, or null when the two
 * cannot be compared.
 * - Windows: the buffer is the HWND as a native-endian (little-endian on x64/arm64) integer,
 *   which is exactly what `EnumWindows` yields.
 * - macOS: the buffer is an `NSView*` pointer, NOT a CGWindowID, so it can never match
 *   `kCGWindowNumber`. On macOS our windows are excluded by pid only: every window of an
 *   Electron app is owned by the main (browser) process, whose pid is `process.pid`.
 */
export function decodeNativeWindowHandle(
  buffer: Buffer,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32") return null;
  if (buffer.length >= 8) return buffer.readBigUInt64LE(0).toString();
  if (buffer.length >= 4) return String(buffer.readUInt32LE(0));
  return null;
}

/** Handles of `windows` (default caller: `BrowserWindow.getAllWindows()`); empty on macOS. */
export function selfWindowHandles(
  windows: { getNativeWindowHandle(): Buffer }[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  return windows.flatMap((window) => {
    const handle = decodeNativeWindowHandle(window.getNativeWindowHandle(), platform);
    return handle === null ? [] : [handle];
  });
}

async function defaultSelf(): Promise<SelfWindows> {
  const { BrowserWindow } = await import("electron");
  return {
    pids: [process.pid],
    handles: selfWindowHandles(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())),
  };
}

const defaultRunCommand: RunCommand = (cmd, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

const defaultDeps: WindowsListerDeps = { runCommand: defaultRunCommand, getSelf: defaultSelf };
