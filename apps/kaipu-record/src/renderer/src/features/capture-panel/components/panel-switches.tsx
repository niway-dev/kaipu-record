import React from "react";
import { Camera, Mic, Volume2, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./panel-switches.module.css";

interface PanelSwitchesProps {
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
  /** Mid-take the three are read-only: disabled, and the off ones dimmed. */
  locked: boolean;
  onToggleMicrophone(): void;
  onToggleSystemAudio(): void;
  onToggleCamera(): void;
}

interface SwitchProps {
  Icon: LucideIcon;
  label: string;
  on: boolean;
  locked: boolean;
  onToggle(): void;
}

function Switch({ Icon, label, on, locked, onToggle }: SwitchProps): React.JSX.Element {
  const t = useTranslations("record");
  return (
    <button
      type="button"
      className={styles.tile}
      aria-pressed={on}
      data-on={on || undefined}
      data-dim={(locked && !on) || undefined}
      disabled={locked}
      onClick={onToggle}
    >
      <Icon size={16} aria-hidden />
      <span className={styles.name}>{label}</span>
      <span className={styles.state}>{on ? t("statusOn") : t("statusOff")}</span>
    </button>
  );
}

/**
 * Mic, Audio and Camera as three on/off tiles (design "Kaipu Capture Home", tray popover).
 * They flip the same recording setup the Capture page's switches do; no settings arrows
 * and no drawers, because the tray only answers "what will this take record".
 */
export function PanelSwitches({
  isMicrophoneEnabled,
  isSystemAudioEnabled,
  isCameraEnabled,
  locked,
  onToggleMicrophone,
  onToggleSystemAudio,
  onToggleCamera,
}: PanelSwitchesProps): React.JSX.Element {
  const t = useTranslations("record");
  return (
    <div {...uiArea("capturePanel.switches")} className={styles.row}>
      <Switch
        Icon={Mic}
        label={t("micLabel")}
        on={isMicrophoneEnabled}
        locked={locked}
        onToggle={onToggleMicrophone}
      />
      <Switch
        Icon={Volume2}
        label={t("audioLabel")}
        on={isSystemAudioEnabled}
        locked={locked}
        onToggle={onToggleSystemAudio}
      />
      <Switch
        Icon={Camera}
        label={t("cameraLabel")}
        on={isCameraEnabled}
        locked={locked}
        onToggle={onToggleCamera}
      />
    </div>
  );
}
