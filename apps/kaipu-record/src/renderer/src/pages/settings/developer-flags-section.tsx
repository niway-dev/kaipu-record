import React from "react";
import { Button, Row, Toggle } from "@kaipu/ui";
import type { FlagName } from "@shared/analytics";
import { reportError } from "@renderer/features/analytics/report-error";
import { useFlagRows } from "@renderer/features/analytics/use-flag-states";
import type { FlagSource } from "@renderer/features/analytics/analytics-client";
import { Section } from "./settings-panel";
import styles from "./settings-page.module.css";

const SOURCE_COPY: Record<FlagSource, string> = {
  override: "pinned here",
  posthog: "from PostHog",
  default: "default (PostHog not loaded or flag absent)",
};

/**
 * One toggle per feature flag, dev builds only (the Developer page is routed only when
 * `import.meta.env.DEV`; main also refuses the change in a packaged app). A toggle pins the flag
 * in every open window right away; "Reset" hands the flag back to PostHog or its default.
 * Copy is intentionally not localized, like the rest of the page.
 */
export function DeveloperFlagsSection(): React.JSX.Element {
  const rows = useFlagRows();
  const pin = (name: FlagName, value: boolean | null): void => {
    // The row only moves when main broadcasts the change, so a refusal must not be silent.
    window.electronAPI.setFlagOverride(name, value).catch((error: unknown) => {
      reportError(`Could not change ${name}`, error, { context: { flag: name } });
    });
  };
  return (
    <>
      <Section title="Feature flags">
        {rows.map(({ name, value, source }) => (
          <Row
            key={name}
            label={name}
            description={`${value ? "On" : "Off"} · ${SOURCE_COPY[source]}`}
            action={
              <>
                {source === "override" && (
                  <Button variant="outline" size="sm" onClick={() => pin(name, null)}>
                    Reset
                  </Button>
                )}
                <Toggle
                  aria-label={name}
                  checked={value}
                  onChange={(checked) => pin(name, checked)}
                />
              </>
            }
          />
        ))}
      </Section>
      <p className={styles.sectionNote}>
        A toggle reaches every open window at once and lasts until the app quits. An editor that is
        already open keeps the value it opened with. <code>KAIPU_FLAG_OVERRIDES</code> still seeds
        the starting values.
      </p>
    </>
  );
}
