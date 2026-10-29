/**
 * One test's wall-clock budget in Playwright (`playwright.config.ts` `timeout`). Shared so
 * the quit watchdog's unit test can check that a hung quit, its stack sample and the
 * launch before them all fit inside it, instead of restating numbers.
 */
export const TEST_TIMEOUT_MS = 120_000;
