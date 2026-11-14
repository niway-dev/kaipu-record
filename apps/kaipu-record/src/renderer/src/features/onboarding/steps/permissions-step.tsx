import type { ReactNode } from "react";
import { Check, Info, MousePointerClick, type LucideIcon } from "lucide-react";
import type { AccessibilityStatus, PermissionKind, PermissionStatus } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { Popover } from "@kaipu/ui";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { uiArea } from "@renderer/lib/ui-area";
import { PERMISSION_META } from "../permissions";
import common from "./step.module.css";
import styles from "./permissions-step.module.css";

/** A grant the user started and the OS has not answered yet. */
export type PendingGrant = PermissionKind | "accessibility";

interface PermissionsStepProps {
  status: PermissionStatus;
  denied: Record<PermissionKind, boolean>;
  /** Grants waiting on the OS: their button shows "Requesting…". */
  pending: ReadonlySet<PendingGrant>;
  onRequest: (kind: PermissionKind) => void;
  onOpenSettings: (kind: PermissionKind) => void;
  /**
   * macOS Accessibility for the click hook. It is not a `PermissionKind` (a single
   * mac-only tri-state, not a per-kind grant), so it gets its own row, and no row at all
   * when "not-required".
   */
  accessibility: AccessibilityStatus;
  onRequestAccessibility: () => void;
}

interface RowProps {
  icon: LucideIcon;
  name: string;
  required: boolean;
  description: string;
  /** Extra detail behind an (i), for the row whose one line cannot say everything. */
  detail?: string;
  granted: boolean;
  action: ReactNode;
}

function PermissionRow({
  icon: Icon,
  name,
  required,
  description,
  detail,
  granted,
  action,
}: RowProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div className={`${styles.row} ${granted ? styles.rowGranted : ""}`}>
      <span className={granted ? styles.iconGranted : styles.icon}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div className={styles.text}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{name}</span>
          <span className={required ? styles.required : styles.optional}>
            {required ? t("required") : t("optional")}
          </span>
          {detail && (
            <Popover
              trigger={
                <span
                  className={styles.infoIcon}
                  role="img"
                  aria-label={t("whatIs", { label: name })}
                >
                  <Info size={13} />
                </span>
              }
            >
              <p className={styles.info}>{detail}</p>
            </Popover>
          )}
        </div>
        <p className={styles.description}>{description}</p>
      </div>
      {granted ? (
        <span className={styles.granted}>
          <Check size={14} strokeWidth={2.4} /> {t("granted")}
        </span>
      ) : (
        action
      )}
    </div>
  );
}

/** Permissions: screen and microphone required, camera and Accessibility optional. */
export function PermissionsStep({
  status,
  denied,
  pending,
  onRequest,
  onOpenSettings,
  accessibility,
  onRequestAccessibility,
}: PermissionsStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");

  const grantButton = (
    grant: PendingGrant,
    required: boolean,
    onClick: () => void,
    label: string,
  ) =>
    pending.has(grant) ? (
      <span className={styles.requesting}>{t("requesting")}</span>
    ) : (
      <button
        type="button"
        className={required ? styles.grantPrimary : styles.grant}
        onClick={onClick}
      >
        {label}
      </button>
    );

  return (
    <div {...uiArea("onboarding.permissionsStep")} className={`${common.step} ${styles.step}`}>
      <span className={common.mark}>
        <KaipuLogo use="permissions" size={68} />
      </span>
      <h1 className={common.title}>{t("permTitle")}</h1>
      <p className={common.subtitle}>
        {t(isWindowsHost() ? "permSubtitleWindows" : "permSubtitle")}
      </p>

      <div className={styles.rows}>
        {PERMISSION_META.map(({ kind, icon, nameKey, required, descriptionKey }) => {
          const granted = status[kind];
          return (
            <PermissionRow
              key={kind}
              icon={icon}
              name={t(nameKey)}
              required={required}
              description={t(descriptionKey)}
              granted={granted}
              action={
                denied[kind] ? (
                  // The OS will not ask twice: only System Settings can grant it now.
                  <button
                    type="button"
                    className={styles.grant}
                    onClick={() => onOpenSettings(kind)}
                  >
                    {t("openSettings")}
                  </button>
                ) : (
                  grantButton(kind, required, () => onRequest(kind), t("grant"))
                )
              }
            />
          );
        })}

        {accessibility !== "not-required" && (
          <PermissionRow
            icon={MousePointerClick}
            name={t("accessibilityTitle")}
            required={false}
            description={t("accessibilityDesc")}
            detail={t("accessibilityDetail")}
            granted={accessibility === "granted"}
            // Granting happens in System Settings; `requestAccessibility()` registers the
            // app, prompts once and deep-links the pane, so one button covers both the
            // first ask and the retry (there is no "denied" branch to detect).
            action={grantButton(
              "accessibility",
              false,
              onRequestAccessibility,
              t("accessibilityGrant"),
            )}
          />
        )}
      </div>
    </div>
  );
}
