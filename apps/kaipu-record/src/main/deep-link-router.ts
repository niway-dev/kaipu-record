import { findDeepLinkInArgv, parseDeepLink } from "./services/deep-link";

export interface DeepLinkRouterDeps {
  /** Finish a browser sign-in with the code from the link. */
  completeSignIn(code: string): Promise<unknown>;
  /** Bring the app forward — skipped by the caller while a recording hides the window. */
  focus(): void;
}

export interface DeepLinkRouter {
  /** A link reported by the OS (`open-url` on macOS). Queued until {@link start}. */
  receive(url: string): void;
  /** Look for a link in a command line (cold start, or a second instance's). True if one was found. */
  receiveArgv(argv: readonly string[]): boolean;
  /** The app is ready: links that arrived during start-up are handled now, later ones at once. */
  start(): void;
}

/**
 * Where every `kaipu://` link ends up, whichever way the platform delivered it.
 *
 * macOS can deliver a link before the app is ready (cold start by link), and Windows/Linux put
 * it in argv, so links are queued until `start()`. Never logs a URL: the sign-in link carries a
 * single-use code in its fragment.
 */
export function createDeepLinkRouter(deps: DeepLinkRouterDeps): DeepLinkRouter {
  let started = false;
  const queue: string[] = [];

  async function dispatch(url: string): Promise<void> {
    const link = parseDeepLink(url);
    if (!link) return;
    if (link.kind === "auth-callback") {
      deps.focus();
      await deps.completeSignIn(link.token);
      return;
    }
    // Reserved for later features (e.g. kaipu://billing/refresh): recognised, deliberately inert.
    console.info(`deep link ${link.path || "/"} is not handled yet; ignoring`);
  }

  function receive(url: string): void {
    if (!started) queue.push(url);
    else
      void dispatch(url).catch((error) => {
        console.error("failed to handle a deep link", error);
      });
  }

  return {
    receive,
    receiveArgv(argv) {
      const url = findDeepLinkInArgv(argv);
      if (!url) return false;
      receive(url);
      return true;
    },
    start() {
      started = true;
      for (const url of queue.splice(0)) receive(url);
    },
  };
}
