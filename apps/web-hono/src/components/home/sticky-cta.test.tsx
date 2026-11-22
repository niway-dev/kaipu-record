import { act, cleanup } from "@testing-library/react";
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

import { StickyCta } from "./sticky-cta";

let report: (isIntersecting: boolean) => void = () => {};

beforeEach(() => {
  document.body.innerHTML = '<section id="top"></section>';
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = (isIntersecting) => callback([{ isIntersecting }]);
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bar = () => document.querySelector<HTMLElement>("[hidden], a[data-placement='sticky']")!;
const hidden = (container: HTMLElement) => container.firstElementChild!.hasAttribute("hidden");

describe("StickyCta", () => {
  it("on the home page hides while the hero is on screen and returns below it", () => {
    const { container } = renderWithProviders(<StickyCta hideOverHero />);
    expect(hidden(container)).toBe(true);
    act(() => report(false));
    expect(hidden(container)).toBe(false);
    act(() => report(true));
    expect(hidden(container)).toBe(true);
    expect(bar()).toBeTruthy();
  });

  it("on the other marketing pages stays visible even though their hero is also #top", () => {
    const { container } = renderWithProviders(<StickyCta />);
    expect(hidden(container)).toBe(false);
    act(() => report(true));
    expect(hidden(container)).toBe(false);
  });
});
