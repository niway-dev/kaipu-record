import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * The whole setup. The renderer's equivalent needs ~150 lines of IPC, i18n and
 * settings stubs; these components need none, because nothing here may import a
 * router, @kaipu/i18n, IPC or the domain. If this file ever starts growing
 * stubs, the dependency boundary has been crossed somewhere.
 *
 * Vitest does not expose `afterEach` as a global, so Testing Library's
 * automatic cleanup never registers on its own.
 */
afterEach(() => {
  cleanup();
});
