import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaUrl } from "@shared/media-url";
import { LibraryVault } from "./library/library-vault";

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  directory: "",
}));

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn((_scheme: string, handler: (request: Request) => Promise<Response>) => {
      state.handler = handler;
    }),
  },
}));

vi.mock("./library", () => ({
  recordingFilePath: (id: string) => new LibraryVault(state.directory).filePath(id),
  screenshotFilePath: (id: string) => new LibraryVault(state.directory).filePath(id),
  thumbnailFilePath: (id: string) => join(state.directory, ".kaipu", `${id}.jpg`),
  webcamFilePath: (id: string) => new LibraryVault(state.directory).webcamFilePath(id),
}));

vi.mock("./workspaces", () => ({ activeWorkspace: () => ({ id: "ws-a" }) }));

import { registerMediaProtocol } from "./media-protocol";

const get = (url: string): Promise<Response> => state.handler!(new Request(url));

describe("kaipu-media:// handler (NIW2-560: ids are file names derived from titles)", () => {
  beforeEach(async () => {
    state.directory = await mkdtemp(join(tmpdir(), "kaipu-media-"));
    registerMediaProtocol();
  });
  afterEach(async () => {
    await rm(state.directory, { recursive: true, force: true });
  });

  it.each(["Demo #1", "50% done", "What? Why", "a%2Fb"])(
    "serves the item named %j, not a prefix of it",
    async (id) => {
      await writeFile(join(state.directory, `${id}.png`), `bytes of ${id}`);
      // A decoy that an unencoded URL would address ("Demo " for "Demo #1").
      await writeFile(join(state.directory, "Demo .png"), "decoy");
      const response = await get(mediaUrl("screenshot", id, { v: "1", w: "ws-a" }));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`bytes of ${id}`);
    },
  );

  it("serves a thumbnail under an id with reserved URL characters", async () => {
    await mkdir(join(state.directory, ".kaipu"), { recursive: true });
    await writeFile(join(state.directory, ".kaipu", "Demo #1.jpg"), "poster");
    const response = await get(mediaUrl("thumb", "Demo #1"));
    expect(await response.text()).toBe("poster");
  });

  it("answers 404 to an encoded id stamped for another workspace", async () => {
    await writeFile(join(state.directory, "Demo #1.png"), "bytes");
    const response = await get(mediaUrl("screenshot", "Demo #1", { w: "ws-b" }));
    expect(response.status).toBe(404);
  });

  it("answers 400 to a malformed escape instead of throwing", async () => {
    await expect(get("kaipu-media://recording/%E0%A4%A")).resolves.toMatchObject({ status: 400 });
  });

  it("answers 400 to an id that would leave the vault", async () => {
    await expect(get("kaipu-media://recording/..%2F..%2Fsecret")).resolves.toMatchObject({
      status: 400,
    });
  });
});

describe("kaipu-media://webcam/<id> (ADR 0037)", () => {
  beforeEach(async () => {
    state.directory = await mkdtemp(join(tmpdir(), "kaipu-media-"));
    await mkdir(join(state.directory, ".kaipu"), { recursive: true });
    await writeFile(join(state.directory, ".kaipu", "Demo #1.webcam.mp4"), "0123456789");
    await writeFile(join(state.directory, "Demo #1.mp4"), "screen-bytes");
    registerMediaProtocol();
  });
  afterEach(async () => {
    await rm(state.directory, { recursive: true, force: true });
  });

  const webcamUrl = (id: string) => `kaipu-media://webcam/${encodeURIComponent(id)}`;
  const getRange = (url: string, range: string): Promise<Response> =>
    state.handler!(new Request(url, { headers: { range } }));

  it("serves the webcam file whole with Range support advertised", async () => {
    const response = await get(webcamUrl("Demo #1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await response.text()).toBe("0123456789");
  });

  it("answers a Range request with 206 and the requested bytes of the webcam file", async () => {
    const response = await getRange(webcamUrl("Demo #1"), "bytes=2-5");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("is 404 when the take has no webcam file, and the screen route is unchanged", async () => {
    expect((await get(webcamUrl("other"))).status).toBe(404);
    expect(await (await get(mediaUrl("recording", "Demo #1"))).text()).toBe("screen-bytes");
  });

  it("refuses an unsafe id", async () => {
    expect((await get("kaipu-media://webcam/..%2Fsecret")).status).toBe(400);
    expect((await get("kaipu-media://webcam/a%5Cb")).status).toBe(400);
  });
});
