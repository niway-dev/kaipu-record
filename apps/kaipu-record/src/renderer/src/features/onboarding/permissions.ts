import { Monitor, Mic, Video, type LucideIcon } from "lucide-react";
import type { PermissionKind, PermissionStatus } from "@shared/types";

/**
 * Onboarding-specific permission logic + display metadata: which permissions
 * gate finishing setup, and the row metadata the permissions step renders. Kept
 * free of React and Electron so it is trivially unit-testable. The generic
 * permission bridge lives in `features/permissions/`.
 */

/** Permissions that must be granted before the user can finish onboarding. */
export const REQUIRED_PERMISSIONS: readonly PermissionKind[] = ["screen", "microphone"];

/** True once every required permission is granted (camera is optional). */
export function requiredPermissionsMet(status: PermissionStatus): boolean {
  return REQUIRED_PERMISSIONS.every((kind) => status[kind]);
}

export interface PermissionMeta {
  kind: PermissionKind;
  icon: LucideIcon;
  /** i18n key under the `onboarding` namespace for this permission's display name. */
  nameKey: "permScreenName" | "permMicName" | "permCameraName";
  required: boolean;
  /** i18n key under the `onboarding` namespace for this permission's description. */
  descriptionKey: "permScreenDesc" | "permMicDesc" | "permCameraDesc";
}

/** Row metadata for the permissions step, in display order. */
export const PERMISSION_META: readonly PermissionMeta[] = [
  {
    kind: "screen",
    icon: Monitor,
    nameKey: "permScreenName",
    required: true,
    descriptionKey: "permScreenDesc",
  },
  {
    kind: "microphone",
    icon: Mic,
    nameKey: "permMicName",
    required: true,
    descriptionKey: "permMicDesc",
  },
  {
    kind: "camera",
    icon: Video,
    nameKey: "permCameraName",
    required: false,
    descriptionKey: "permCameraDesc",
  },
];
