import type { CloudControl } from "@kaipu/domain/repositories";

export const CLOUD_UPLOADS_USAGE = "Usage: bun run cloud:uploads <status|on|off>";

export interface CloudControlStore {
  getControl(): Promise<CloudControl>;
  setUploadsEnabled(enabled: boolean): Promise<CloudControl>;
}

/**
 * The global upload switch (plan 01 Task 0 #9 — no hand-written SQL). Pure over the store so it
 * is testable; `scripts/cloud-uploads.ts` wires the real repository.
 *
 * Off: `POST /assets/upload-intents` answers SERVICE_UNAVAILABLE and `/me/storage` reports
 * `uploadsEnabled: false`. Downloads, deletes and PUTs already running with an issued URL are not
 * cut. A missing row means enabled, so production must run `off` once to create it closed.
 */
export async function runCloudUploadsCommand(
  command: string | undefined,
  store: CloudControlStore,
  out: (line: string) => void,
): Promise<number> {
  if (command !== "status" && command !== "on" && command !== "off") {
    out(CLOUD_UPLOADS_USAGE);
    return 2;
  }
  const control =
    command === "status"
      ? await store.getControl()
      : await store.setUploadsEnabled(command === "on");
  out(`cloud uploads: ${control.uploadsEnabled ? "enabled" : "PAUSED"}`);
  if (command === "off") {
    out("New uploads are refused. Transfers already running and URLs already issued are not cut.");
  }
  return 0;
}
