import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

vi.mock("@kaipu/brand", () => ({ KaipuLogo: () => null }));
vi.mock("@/components/download-link", () => ({
  DownloadLink: ({
    children,
    href,
    placement,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { placement: string; href: string }) => (
    <a href={href} data-placement={placement} {...rest}>
      {children}
    </a>
  ),
}));

import { Hero } from "./hero";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tab = (name: string) => screen.getByRole("button", { name });
const go = (name: string) => fireEvent.click(tab(name));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const status = () => screen.getByTestId("auto-status").textContent;
const eyebrow = () => screen.getByText("Screen capture and editing for Mac");
const picker = () => screen.getByRole("group", { name: "What Kaipu does" });
/** The still picture the phone's overview shows where the other steps show their screen. */
const preview = () => document.querySelector<HTMLElement>("[class*='preview']");

describe("the phone's first screen says what Kaipu is, whichever step is showing", () => {
  it("leads with a category line and a two-sentence headline that never change", () => {
    renderWithProviders(<Hero />);
    const headline = () =>
      Array.from(eyebrow().nextElementSibling!.querySelectorAll("span"), (s) => s.textContent);
    expect(headline()).toEqual(["Record your screen.", "Edit videos and screenshots."]);

    for (const step of ["Record", "Screenshot", "Edit", "Export", "Overview"]) {
      go(step);
      expect(eyebrow().textContent).toBe("Screen capture and editing for Mac");
      expect(headline()).toEqual(["Record your screen.", "Edit videos and screenshots."]);
    }
  });

  it("is in Spanish too", () => {
    renderWithProviders(<Hero />, "es");
    expect(screen.getByText("Captura y edición de pantalla para Mac")).toBeTruthy();
    expect(screen.getByText("Graba tu pantalla.")).toBeTruthy();
    expect(screen.getByText("Edita videos y capturas.")).toBeTruthy();
  });

  it("reads in the order the page shows: what it is, the picker, the screen, then the download", () => {
    renderWithProviders(<Hero />);
    go("Record");
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const screenGroup = screen.getByRole("group", { name: "Demo screen" });
    const cta = screen.getByRole("link", { name: /View downloads/ });
    expect(cta.getAttribute("href")).toBe("#download");
    expect(before(eyebrow(), picker())).toBe(true);
    expect(before(picker(), screenGroup)).toBe(true);
    expect(before(screenGroup, cta)).toBe(true);
  });
});

describe("the picker's cards", () => {
  it("name each step and say what it handles, with the step's name as the control's name", () => {
    renderWithProviders(<Hero />);
    const hints = {
      Record: "Screen and voice",
      Screenshot: "Any area",
      Edit: "Videos and images",
      Export: "Ready to share",
    };
    for (const [step, hint] of Object.entries(hints)) {
      const card = tab(step);
      expect(within(card).getByText(hint).getAttribute("aria-hidden")).toBe("true");
      // The hint is part of the picture, not of the name: assistive tech hears "Edit", not "Edit Videos and images".
      expect(card.getAttribute("aria-label")).toBe(step);
    }
    // The overview is a state, not a card: it has no icon and no hint.
    expect(tab("Overview").textContent).toBe("Overview");
  });

  it("still switch the step and keep their pressed state", () => {
    renderWithProviders(<Hero />);
    go("Edit");
    expect(tab("Edit").getAttribute("aria-pressed")).toBe("true");
    expect(tab("Record").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit it.");
  });

  it("are named in Spanish", () => {
    renderWithProviders(<Hero />, "es");
    for (const [step, hint] of [
      ["Grabar", "Pantalla y voz"],
      ["Captura", "Cualquier área"],
      ["Editar", "Videos e imágenes"],
      ["Exportar", "Listo para compartir"],
    ]) {
      expect(within(tab(step!)).getByText(hint!)).toBeTruthy();
    }
  });
});

describe("the overview's picture on a phone", () => {
  it("is decorative: no control, no timer, no status, and it is not the demo screen", () => {
    renderWithProviders(<Hero />);
    const picture = preview()!;
    expect(picture).toBeTruthy();
    expect(picture.getAttribute("aria-hidden")).toBe("true");
    expect(within(picture).queryAllByRole("button", { hidden: true })).toHaveLength(0);
    expect(within(picture).queryAllByRole("link", { hidden: true })).toHaveLength(0);
    expect(within(picture).queryByRole("timer", { hidden: true })).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("group", { name: "Demo screen" })).toBeNull();
  });

  it("shows the sample page the steps film, capture and edit", () => {
    renderWithProviders(<Hero />);
    // The overview's own headline stays (for assistive tech); the picture draws the same statement.
    expect(within(preview()!).getByText(/From your screen\./)).toBeTruthy();
  });

  it("leaves the overview's controls to the picker and the countdown: one set, no duplicates", () => {
    renderWithProviders(<Hero />);
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual([
      "Overview",
      "Record",
      "Screenshot",
      "Edit",
      "Export",
      "Pause the auto demo",
    ]);
  });

  it("never holds the auto demo, whatever the visitor does to it", () => {
    renderWithProviders(<Hero />);
    const picture = preview()!;
    fireEvent.pointerEnter(picture, { pointerType: "mouse" });
    fireEvent.pointerDown(picture);
    tick(3000);
    expect(status()).toBe("Next: Record in 7s");
    tick(7000);
    expect(tab("Record").getAttribute("aria-pressed")).toBe("true");
    expect(preview()).toBeNull();
  });

  it("goes away when a step is picked and comes back when the demo returns to the overview", () => {
    renderWithProviders(<Hero />);
    go("Record");
    expect(preview()).toBeNull();
    expect(screen.getByRole("group", { name: "Demo screen" })).toBeTruthy();
    go("Overview");
    expect(preview()).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Demo screen" })).toBeNull();
  });
});

describe("the countdown on a phone", () => {
  it("keeps the sentence for assistive tech and the pause control, only smaller on screen", () => {
    renderWithProviders(<Hero />);
    expect(status()).toBe("Next: Record in 10s");
    tick(4000);
    expect(status()).toBe("Next: Record in 6s");
    fireEvent.click(tab("Pause the auto demo"));
    expect(status()).toBe("Auto demo paused");
    expect(tab("Play the auto demo").hasAttribute("aria-pressed")).toBe(false);
  });
});

describe("the layout contract", () => {
  const css = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  /** The body of the first `@media (width < N px)` block that contains `needle`. */
  const mediaWith = (file: string, query: string, needle: string) =>
    css(file)
      .split("@media")
      .find((chunk) => chunk.trimStart().startsWith(`(${query})`) && chunk.includes(needle));

  it("turns the phone layout on at 1080px, where the stage's own layout changes", () => {
    expect(
      mediaWith("hero.module.css", "width < 1080px", ".compactEyebrow {\n    display: block"),
    ).toBeTruthy();
    expect(mediaWith("hero.module.css", "width < 1080px", "grid-template-areas")).toBeTruthy();
    expect(
      mediaWith("hero-stage.module.css", "width < 1080px", ".preview {\n    position: relative"),
    ).toBeTruthy();
  });

  it("keeps the phone-only parts out of the desktop picker and stage", () => {
    const hero = css("hero.module.css");
    // Outside any media query the cards' icon and hint, the headline and the picture are hidden.
    const base = hero.slice(0, hero.indexOf("@media"));
    expect(base).toMatch(
      /\.compactEyebrow,\s*\.compactTitle,\s*\.modeIcon,\s*\.modeHint \{\s*display: none;/,
    );
    expect(css("hero-stage.module.css")).toMatch(/\.preview \{\s*display: none;/);
  });

  it("gives a phone's screen nearly the whole width, not the page's 24px gutter", () => {
    const phone = mediaWith("hero-stage.module.css", "width < 640px", ".stage");
    expect(phone).toMatch(/margin-inline: calc\(10px - var\(--kl-gutter\)\)/);
    expect(phone).toMatch(/max-width: none/);
  });
  it("keeps the saved folder and length on a phone instead of hiding them", () => {
    const compact = css("hero-stage.module.css").split("@container (max-width: 520px)")[1]!;
    expect(compact).not.toMatch(/\.dockText \{[^}]*display: none/);
    expect(compact).toMatch(/\.dockText \{[^}]*flex: 1 0 100%/);
  });

  it("lets reduced motion win over the phone's card transitions, which come earlier in the file", () => {
    const hero = css("hero.module.css");
    const last = hero.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(last).toBeGreaterThan(hero.lastIndexOf("@media (width < 1080px)"));
    expect(hero.slice(last)).toMatch(/\.mode,\s*\.modeIcon \{\s*transition: none;/);
  });

  it("stops the overview picture's animations while the demo is paused", () => {
    expect(css("hero.module.css")).toMatch(
      /\.hero\[data-paused\] \.frame,\s*\.hero\[data-paused\] \.frame::after,\s*\.hero\[data-paused\] \.cursor \{\s*animation-play-state: paused;/,
    );
  });

  it("sizes the headline's selection frame from the headline, not from the body text", () => {
    const hero = css("hero.module.css");
    expect(hero).toMatch(/\.titleWrap \{[^}]*font-size: clamp\(48px, 6vw, 88px\)/);
    expect(hero).toMatch(/\.titleWrap \.title \{[^}]*font-size: inherit/);
    expect(hero).toMatch(/\[data-mode="overview"\] \.titleWrap \{\s*font-size: clamp\(64px/);
  });

  it("gives the phone's download pill a readable size", () => {
    const narrow = mediaWith("hero-stage.module.css", "width < 980px", ".samplePhone")!;
    expect(narrow).toMatch(/\.samplePhone \{[^}]*font-size: 13px/);
  });
});
