// No-CDP memory check (NIW2-844 layer 2). Runs the filmstrip probe worker on the real take in a
// bare Electron window, with nothing attached (CDP_MODE=none), with only the DevTools Network
// domain enabled on the page and its workers (CDP_MODE=network, what Playwright does), or with
// the Runtime domain only (CDP_MODE=runtime). After every checkpoint it prints the footprint
// (`footprint -p`) of each renderer and of the GPU process. A local HTTP server serves the
// probe bundles and the take by Range. See run.sh. Never shipped.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const { execFile } = require("node:child_process");

const MODE = process.env.CDP_MODE || "none";
const DECODER = process.env.DECODER || "hardware";
const REQUESTS = Number(process.env.REQS || 150);
const TAKE = process.env.TAKE;
const PROBE = process.env.PROBE_BUNDLE;
const DRIVER = process.env.DRIVER_BUNDLE;
const CHECKPOINTS = (process.env.CHECKPOINTS || "1,3,50,150").split(",").map(Number);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30 * 60 * 1000);

// A hung driver or a thrown error must end the run with a code, never hang the shell script.
const fail = (error) => {
  // Not the `[mode/decoder]` prefix: run.sh keeps only those lines in the results file.
  console.error(`FAILED (${MODE}/${DECODER}):`, error);
  app.exit(1);
};

// Armed first, so a bad take path, a busy port or a hung driver all end the run.
setTimeout(() => fail(new Error(`no result after ${TIMEOUT_MS} ms`)), TIMEOUT_MS).unref();
process.on("uncaughtException", fail);

const size = fs.statSync(TAKE).size;

const server = http.createServer((req, res) => {
  if (req.url === "/page.html") {
    res.setHeader("content-type", "text/html");
    return res.end('<script type="module" src="/driver.js"></script>');
  }
  if (req.url === "/probe.js" || req.url === "/driver.js") {
    res.setHeader("content-type", "text/javascript");
    return fs.createReadStream(req.url === "/probe.js" ? PROBE : DRIVER).pipe(res);
  }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(m ? 206 : 200, {
    "content-range": `bytes ${start}-${end}/${size}`,
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    "content-type": "video/mp4",
  });
  const stream = fs.createReadStream(TAKE, { start, end });
  stream.pipe(res);
  res.on("close", () => stream.destroy());
});

const footprint = (pid) =>
  new Promise((resolve) =>
    execFile("footprint", ["-p", String(pid)], (error, out) => {
      const found = /Footprint:\s+([\d.]+\s*\w+)/i.exec(out || "");
      resolve(found ? found[1] : "?");
    }),
  );

async function sample(label) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const parts = [];
  for (const metric of app.getAppMetrics()) {
    if (metric.type === "Tab" || metric.type === "GPU")
      parts.push(`${metric.type}=${await footprint(metric.pid)}`);
  }
  console.log(`[${MODE}/${DECODER}] ${label}: ${parts.join(" ")}`);
}

server.on("error", fail);

app.whenReady().then(() =>
  server.listen(process.env.PORT || 8766, "127.0.0.1", async () => {
    try {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await win.loadURL(`http://127.0.0.1:${process.env.PORT || 8766}/page.html`);
      if (MODE !== "none") {
        const dbg = win.webContents.debugger;
        dbg.attach("1.3");
        dbg.on("message", (_event, method, params) => {
          if (method === "Target.attachedToTarget" && params.targetInfo.type === "worker")
            dbg.sendCommand(
              MODE === "network" ? "Network.enable" : "Runtime.enable",
              {},
              params.sessionId,
            );
        });
        await dbg.sendCommand(MODE === "network" ? "Network.enable" : "Runtime.enable", {});
        await dbg.sendCommand("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
      }
      const js = (code) => win.webContents.executeJavaScript(code);
      await sample("before the worker");
      await js(`window.__driver.start(${JSON.stringify(DECODER)})`);
      await sample("start");
      let at = 0;
      for (const next of [...CHECKPOINTS.filter((n) => n < REQUESTS), REQUESTS]) {
        await js(`window.__driver.run(${at}, ${next})`);
        at = next;
        await sample(`req=${next}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 12000));
      await sample("12 s after the last request (idle close)");
      app.exit(0);
    } catch (error) {
      fail(error);
    }
  }),
);
