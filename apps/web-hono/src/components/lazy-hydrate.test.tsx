import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyHydrate } from "./lazy-hydrate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

let callback: Callback | undefined;
let options: IntersectionObserverInit | undefined;

class FakeObserver {
  constructor(cb: Callback, opts?: IntersectionObserverInit) {
    callback = cb;
    options = opts;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function Probe({ onRender }: { onRender: () => void }) {
  onRender();
  return <p>server text</p>;
}

/** Adopt markup the way the browser does: it is already in the document. */
function hydrate(onRender: () => void) {
  const container = document.createElement("div");
  container.innerHTML = "<div><p>server text</p></div>";
  document.body.appendChild(container);
  act(() => {
    hydrateRoot(
      container,
      <LazyHydrate>
        <Probe onRender={onRender} />
      </LazyHydrate>,
    );
  });
  return container;
}

describe("LazyHydrate", () => {
  beforeEach(() => {
    callback = undefined;
    options = undefined;
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps the server markup and renders nothing until the section nears the viewport", () => {
    const onRender = vi.fn();
    const container = hydrate(onRender);

    expect(onRender).not.toHaveBeenCalled();
    expect(container.textContent).toBe("server text");
    expect(options?.rootMargin).toBe("400px 0px");
  });

  it("renders the children once the observer reports intersection", () => {
    const onRender = vi.fn();
    const container = hydrate(onRender);

    act(() => callback?.([{ isIntersecting: false }]));
    expect(onRender).not.toHaveBeenCalled();

    act(() => callback?.([{ isIntersecting: true }]));
    expect(onRender).toHaveBeenCalled();
    expect(container.textContent).toBe("server text");
  });

  it("renders the children on first interaction inside the section", () => {
    const onRender = vi.fn();
    const container = hydrate(onRender);

    act(() => {
      container.querySelector("p")?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    expect(onRender).toHaveBeenCalled();
  });

  it("renders the children immediately when IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onRender = vi.fn();
    hydrate(onRender);

    expect(onRender).toHaveBeenCalled();
  });

  it("renders the children immediately on a client render with no server markup", () => {
    const onRender = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      createRoot(container).render(
        <LazyHydrate>
          <Probe onRender={onRender} />
        </LazyHydrate>,
      );
    });

    expect(onRender).toHaveBeenCalled();
    expect(container.textContent).toBe("server text");
  });
});
