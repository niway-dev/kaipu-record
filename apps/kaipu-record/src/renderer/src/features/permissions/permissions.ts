import type { PermissionStatus } from "@shared/types";

/**
 * Generic OS-permission helpers, kept free of React and Electron so they stay
 * trivially unit-testable. The side-effecting bridge lives in `use-permissions.ts`
 * and the main process. Onboarding-specific gating (which permissions are
 * *required* to finish setup, and the step's display metadata) lives in
 * `features/onboarding/permissions.ts`.
 */

/** All-denied seed used before the first status read resolves. */
export const EMPTY_PERMISSION_STATUS: PermissionStatus = {
  screen: false,
  microphone: false,
  camera: false,
};
