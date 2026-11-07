import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toLayout } from "../timeline";
import { availableTracks } from "../tracks";
import { TransportBar, type TransportBarProps } from "./transport-bar";

// The shared test setup pins the i18n hooks to English. The speed label is a number the
// locale writes (1.5 in English, 1,5 in Spanish), so this file switches the locale the
// hooks report and resolves the messages from that locale's real catalog.
const locale = vi.hoisted(() => ({ current: "en" as "en" | "es" }));

vi.mock("@kaipu/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kaipu/i18n")>();
  const { default: en } = await import("@kaipu/i18n/messages/en");
  const { default: es } = await import("@kaipu/i18n/messages/es");
  return {
    ...actual,
    I18nProvider: ({ children }: { children: unknown }) => children,
    useTranslations: (namespace?: keyof typeof en) =>
      actual.createTranslator({
        locale: locale.current,
        messages: locale.current === "es" ? es : en,
        namespace,
        getMessageFallback: ({ namespace, key }) => (namespace ? `${namespace}.${key}` : key),
      }),
    useLocale: () => locale.current,
    useSetLocale: () => () => {},
  };
});

function renderBar(speed: number): TransportBarProps {
  const props: TransportBarProps = {
    layout: toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 }]),
    playing: false,
    muted: false,
    speed,
    timelineTime: 0,
    duration: 10,
    isFullscreen: false,
    zoomCount: null,
    privacyCount: 0,
    tracks: {
      available: availableTracks({ hasCursorTrack: true, hasWebcam: false }),
      hidden: [],
      onToggle: vi.fn(),
    },
    onTogglePlay: vi.fn(),
    onToggleMute: vi.fn(),
    onSpeedChange: vi.fn(),
    onSeek: vi.fn(),
    onSplit: vi.fn(),
    splitDisabled: false,
    onDeleteSelected: vi.fn(),
    deleteDisabled: false,
    onToggleFullscreen: vi.fn(),
  };
  render(<TransportBar {...props} />);
  return props;
}

describe("TransportBar — the speed label follows the locale's number format", () => {
  beforeEach(() => {
    locale.current = "en";
  });

  it("writes 1.5× with a dot in English: label, accessible name and tooltip", () => {
    renderBar(1.5);
    const button = screen.getByRole("button", { name: /^Playback speed/ });
    expect(button).toHaveTextContent("1.5×");
    expect(button).toHaveAccessibleName("Playback speed 1.5×");
    expect(button).toHaveAttribute("title", "Playback speed: click for 2×");
  });

  it("writes 0.5× with a dot in English when it is the next speed", () => {
    renderBar(2);
    const button = screen.getByRole("button", { name: /^Playback speed/ });
    expect(button).toHaveAttribute("title", "Playback speed: click for 0.5×");
  });

  it("writes 1,5× with a comma in Spanish: label, accessible name and tooltip", () => {
    locale.current = "es";
    renderBar(1.5);
    const button = screen.getByRole("button", { name: /^Velocidad de reproducción/ });
    expect(button).toHaveTextContent("1,5×");
    expect(button).toHaveAccessibleName("Velocidad de reproducción 1,5×");
    expect(button).toHaveAttribute("title", "Velocidad de reproducción: clic para 2×");
  });

  it("writes 0,5× with a comma in Spanish when it is the current speed", () => {
    locale.current = "es";
    renderBar(0.5);
    const button = screen.getByRole("button", { name: /^Velocidad de reproducción/ });
    expect(button).toHaveTextContent("0,5×");
    expect(button).toHaveAccessibleName("Velocidad de reproducción 0,5×");
    expect(button).toHaveAttribute("title", "Velocidad de reproducción: clic para 1×");
  });

  it("writes 0,5× with a comma in Spanish when it is the next speed", () => {
    locale.current = "es";
    renderBar(2);
    const button = screen.getByRole("button", { name: /^Velocidad de reproducción/ });
    expect(button).toHaveAttribute("title", "Velocidad de reproducción: clic para 0,5×");
  });

  it("still asks for the number, not the text: the click passes 2 from 1.5 in Spanish", () => {
    locale.current = "es";
    const props = renderBar(1.5);
    fireEvent.click(screen.getByRole("button", { name: /^Velocidad de reproducción/ }));
    expect(props.onSpeedChange).toHaveBeenCalledExactlyOnceWith(2);
  });
});
