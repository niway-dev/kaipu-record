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
  name: string;
  required: boolean;
  description: string;
}

/** Row metadata for the permissions step, in display order. */
export const PERMISSION_META: readonly PermissionMeta[] = [
  {
    kind: "screen",
    icon: Monitor,
    name: "Screen Recording",
    required: true,
    description: "Capture your full display or a single window in crisp detail.",
  },
  {
    kind: "microphone",
    icon: Mic,
    name: "Microphone",
    required: true,
    description: "Record your narration and voice alongside the screen.",
  },
  {
    kind: "camera",
    icon: Video,
    name: "Camera",
    required: false,
    description: "Add a webcam bubble for demos and a personal touch.",
  },
];
