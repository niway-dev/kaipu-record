import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  dir: "",
  handler: null as null | ((request: Request) => Promise<Response>),
}));

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      state.handler = handler;
    },
  },
}));
vi.mock("./library", () => ({
  recordingFilePath: async (id: string) => join(state.dir, `${id}.mp4`),
  screenshotFilePath: async (id: string) => join(state.dir, `${id}.png`),
  thumbnailFilePath: (id: string) => join(state.dir, ".kaipu", `${id}.jpg`),
  webcamFilePath: (id: string) => join(state.dir, ".kaipu", `${id}.webcam.mp4`),
}));

import { registerMediaProtocol } from "./media-protocol";

describe("kaipu-media://webcam/<id>", () => {
  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "kaipu-media-"));
    await import("node:fs/promises").then((fs) => fs.mkdir(join(state.dir, ".kaipu")));
    await writeFile(join(state.dir, ".kaipu", "rec.webcam.mp4"), "0123456789");
    await writeFile(join(state.dir, "rec.mp4"), "screen-bytes");
    registerMediaProtocol();
  });
  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });

  const get = (url: string, range?: string) =>
    state.handler!(new Request(url, range ? { headers: { range } } : undefined));

  it("serves the webcam file whole with Range support advertised", async () => {
    const response = await get("kaipu-media://webcam/rec");
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await response.text()).toBe("0123456789");
  });

  it("answers a Range request with 206 and the requested bytes of the webcam file", async () => {
    const response = await get("kaipu-media://webcam/rec", "bytes=2-5");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("is 404 when the take has no webcam file, and the screen route is unchanged", async () => {
    expect((await get("kaipu-media://webcam/other")).status).toBe(404);
    expect(await (await get("kaipu-media://recording/rec")).text()).toBe("screen-bytes");
  });

  it("refuses an unsafe id", async () => {
    expect((await get("kaipu-media://webcam/..%2Fsecret")).status).toBe(400);
    expect((await get("kaipu-media://webcam/a%5Cb")).status).toBe(400);
  });
});
