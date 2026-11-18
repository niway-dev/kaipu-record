import { act, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetFilmstripStoreForTests, getFilmstripStore } from "../filmstrip-service";
import type { FilmstripBinding } from "../filmstrip-targets";
import { FilmstripTiles } from "./filmstrip-tiles";
import type { ThumbnailTile } from "./timeline-geometry";

const entry = { sourceStart: 0, sourceEnd: 100 };
const tiles: ThumbnailTile[] = [
  { index: 0, left: 0, width: 0.5, sourceTime: 25 },
  { index: 1, left: 0.5, width: 0.5, sourceTime: 75 },
];
const bindingA: FilmstripBinding = { fileKey: "kaipu-media://a", fileOffset: 0, legacyOffset: 0 };
const bindingB: FilmstripBinding = { fileKey: "kaipu-media://b", fileOffset: 0, legacyOffset: 0 };

/** Image whose `decode()` the test resolves by hand. */
let pendingDecodes: Array<{ src: string; resolve: () => void; reject: () => void }> = [];
class FakeImage {
  src = "";
  decode(): Promise<void> {
    return new Promise((resolve, reject) => {
      pendingDecodes.push({ src: this.src, resolve, reject: () => reject(new Error("decode")) });
    });
  }
}

let urlCount = 0;

beforeEach(() => {
  pendingDecodes = [];
  urlCount = 0;
  vi.stubGlobal("Image", FakeImage);
  URL.createObjectURL = vi.fn(() => `blob:frame-${urlCount++}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  __resetFilmstripStoreForTests();
  vi.unstubAllGlobals();
});

function imgs(container: HTMLElement): HTMLImageElement[] {
  return [...container.querySelectorAll("img")];
}

describe("FilmstripTiles", () => {
  it("shows the opening frames until the store has better ones", () => {
    const { container } = render(
      <FilmstripTiles
        tiles={tiles}
        entry={entry}
        binding={bindingA}
        legacy={[{ sourceTime: 10, url: "blob:legacy" }]}
        className="tile"
      />,
    );
    expect(imgs(container).map((i) => i.getAttribute("src"))).toEqual([
      "blob:legacy",
      "blob:legacy",
    ]);
  });

  it("renders nothing for a file with no frame at all", () => {
    const { container } = render(
      <FilmstripTiles
        tiles={tiles}
        entry={entry}
        binding={bindingA}
        legacy={[]}
        className="tile"
      />,
    );
    expect(imgs(container)).toHaveLength(0);
  });

  it("AC12: keeps the old image until the new one is decoded, then swaps, never blank", async () => {
    const { container } = render(
      <FilmstripTiles
        tiles={[tiles[0]]}
        entry={entry}
        binding={bindingA}
        legacy={[{ sourceTime: 10, url: "blob:legacy" }]}
        className="tile"
      />,
    );
    act(() => {
      getFilmstripStore().add("kaipu-media://a", { timestamp: 24, blob: new Blob(), bytes: 3 });
    });
    // The finer frame (inside the tile's own span) is the pick now, but not yet decoded.
    expect(imgs(container)).toHaveLength(1);
    expect(imgs(container)[0].getAttribute("src")).toBe("blob:legacy");
    expect(pendingDecodes.map((d) => d.src)).toEqual(["blob:frame-0"]);

    await act(async () => {
      pendingDecodes[0].resolve();
    });
    expect(imgs(container)).toHaveLength(1);
    expect(imgs(container)[0].getAttribute("src")).toBe("blob:frame-0");
    expect(imgs(container)[0].dataset.filmstripFrame).toBe("24.000");
    expect(imgs(container)[0].dataset.filmstripSpan).toBe("0.000,50.000");
    expect(imgs(container)[0].dataset.filmstripOwn).toBe("true");
  });

  it("marks a tile whose frame is outside its own span as not its own", () => {
    const { container } = render(
      <FilmstripTiles
        tiles={[tiles[1]]} // span [50, 100]
        entry={entry}
        binding={bindingA}
        legacy={[{ sourceTime: 10, url: "blob:legacy" }]}
        className="tile"
      />,
    );
    expect(imgs(container)[0].dataset.filmstripOwn).toBe("false");
  });

  it("keeps the image on screen when the new one cannot be decoded", async () => {
    const { container } = render(
      <FilmstripTiles
        tiles={[tiles[0]]}
        entry={entry}
        binding={bindingA}
        legacy={[{ sourceTime: 10, url: "blob:legacy" }]}
        className="tile"
      />,
    );
    act(() => {
      getFilmstripStore().add("kaipu-media://a", { timestamp: 24, blob: new Blob(), bytes: 3 });
    });
    await act(async () => {
      pendingDecodes[0].reject();
    });
    expect(imgs(container)[0].getAttribute("src")).toBe("blob:legacy");
  });

  it("re-renders only the tiles of the file whose frame arrived", () => {
    const rendersA: string[] = [];
    const rendersB: string[] = [];
    render(
      <>
        <Profiler id="a" onRender={(id) => rendersA.push(id)}>
          <FilmstripTiles
            tiles={tiles}
            entry={entry}
            binding={bindingA}
            legacy={[]}
            className="t"
          />
        </Profiler>
        <Profiler id="b" onRender={(id) => rendersB.push(id)}>
          <FilmstripTiles
            tiles={tiles}
            entry={entry}
            binding={bindingB}
            legacy={[]}
            className="t"
          />
        </Profiler>
      </>,
    );
    const a0 = rendersA.length;
    const b0 = rendersB.length;
    act(() => {
      getFilmstripStore().add("kaipu-media://a", { timestamp: 10, blob: new Blob(), bytes: 3 });
    });
    expect(rendersA.length).toBeGreaterThan(a0);
    expect(rendersB.length).toBe(b0);
  });

  it("AC10: a cleared store empties the tiles", () => {
    const { container } = render(
      <FilmstripTiles tiles={tiles} entry={entry} binding={bindingA} legacy={[]} className="t" />,
    );
    act(() => {
      getFilmstripStore().add("kaipu-media://a", { timestamp: 10, blob: new Blob(), bytes: 3 });
    });
    expect(imgs(container).length).toBeGreaterThan(0);
    act(() => {
      getFilmstripStore().clear();
    });
    expect(imgs(container)).toHaveLength(0);
  });

  it("a webcam tile outside the footage stays empty", () => {
    const { container } = render(
      <FilmstripTiles
        tiles={tiles}
        entry={entry}
        binding={{ fileKey: "kaipu-media://w", fileOffset: 10, legacyOffset: 10 }}
        legacy={[{ sourceTime: 20, url: "blob:cam" }]}
        covered={{ start: 10, end: 40 }}
        className="t"
      />,
    );
    // Tile 0's centre is source 25 (inside [10, 40)); tile 1's is 75 (outside).
    expect(imgs(container)).toHaveLength(1);
  });
});
