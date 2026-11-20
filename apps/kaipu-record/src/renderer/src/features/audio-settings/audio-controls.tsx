import React, { type Ref } from "react";
import { Mic, Volume2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { Microphone } from "@renderer/features/recording/types";
import { SettingsPopover } from "../settings-controls/settings-popover";
import { SetupCard } from "../settings-controls/setup-card";
import { ToggleSplit } from "../settings-controls/toggle-split";
import {
  useSettingsDisclosure,
  type SettingsDisclosure,
} from "../settings-controls/use-settings-disclosure";
import { MicSettingsContent } from "./mic-settings-content";
import { SystemAudioSettingsContent } from "./system-audio-settings-content";
import { spreadLevels, useMicLevelMeter } from "./use-mic-level-meter";
import { useTakeMicLevels } from "./use-take-mic-levels";
import type { AudioSettingsStore } from "./use-audio-settings";
import type { UiAreaProps } from "@renderer/lib/ui-area";

/** State the Mic (or Audio) split tile and its settings popover share. */
export interface AudioControl extends SettingsDisclosure {
  store: AudioSettingsStore;
}

/**
 * One per tile, over the window's single `AudioSettingsStore` (see `useAudioSettings`):
 * every write sends the whole `audio` object, so two stores in one window would let a
 * throttled write from one restore a stale field of the other.
 */
export function useAudioControl(store: AudioSettingsStore): AudioControl {
  const disclosure = useSettingsDisclosure();
  return { ...disclosure, store };
}

// ── Microphone ──────────────────────────────────────────────────────────────

export interface MicDevices {
  microphones: Microphone[];
  selectedMicrophone: Microphone | null;
  onSelectMicrophone: (microphone: Microphone) => void;
}

interface MicBodyProps extends MicDevices {
  control: AudioControl;
  micOn: boolean;
  isRecording: boolean;
}

/**
 * The mic settings plus where their meter reads from. Mounted only while the popover is open, so the pre-take meter (it opens the device) runs exactly that long: open,
 * mic on, not recording. During a take the engine's mic levels feed it instead (their own channel, only while mounted).
 */
function MicSettingsBody({
  control,
  micOn,
  isRecording,
  microphones,
  selectedMicrophone,
  onSelectMicrophone,
}: MicBodyProps): React.JSX.Element {
  const takeLevels = useTakeMicLevels(isRecording && micOn);
  const preTake = useMicLevelMeter(
    selectedMicrophone?.deviceId ?? null,
    micOn && !isRecording && microphones.length > 0,
    control.store.audio.noiseSuppression,
  );
  const levels = isRecording ? spreadLevels(takeLevels) : preTake;
  return (
    <MicSettingsContent
      microphones={microphones}
      selected={selectedMicrophone}
      onSelect={onSelectMicrophone}
      audio={control.store.audio}
      onChange={control.store.update}
      isRecording={isRecording}
      levels={levels}
    />
  );
}

interface MicTileProps {
  on: boolean;
  onToggle: () => void;
  compact?: boolean;
  /** The Capture page's setup card (name, current choice, switch, chevron) instead of the tile. */
  card?: boolean;
  /** The card's secondary line: the selected microphone's name. */
  selectedMicrophone?: Microphone | null;
  /**
   * The enumerated inputs. The card says "No microphones found" exactly when this is empty,
   * the panel's rule, even if a saved device is still selected (the last input was unplugged);
   * with devices but no selection yet (main's settings still loading) the line stays blank
   * instead of claiming there are none.
   */
  microphones?: Microphone[];
  control: AudioControl;
  ui?: UiAreaProps;
}

export function MicToggleSplit({
  control,
  on,
  onToggle,
  compact,
  card = false,
  selectedMicrophone = null,
  microphones = [],
  ui,
}: MicTileProps): React.JSX.Element {
  const t = useTranslations("micSettings");
  const tRecord = useTranslations("record");
  if (card) {
    return (
      <SetupCard
        icon={Mic}
        name={t("microphone")}
        detail={microphones.length === 0 ? t("noDevices") : (selectedMicrophone?.label ?? "\u00a0")}
        status={on ? tRecord("statusOn") : tRecord("statusOff")}
        on={on}
        onToggle={onToggle}
        ui={ui}
        chevronLabel={t("title")}
        open={control.open}
        onOpenChange={control.setOpen}
        controlsId={control.settingsId}
        chevronRef={control.chevronRef as Ref<HTMLButtonElement>}
      />
    );
  }
  return (
    <ToggleSplit
      icon={Mic}
      label={tRecord("micLabel")}
      status={on ? tRecord("statusOn") : tRecord("statusOff")}
      on={on}
      onToggle={onToggle}
      ui={ui}
      chevronLabel={t("title")}
      compact={compact}
      open={control.open}
      onOpenChange={control.setOpen}
      controlsId={control.settingsId}
      chevronRef={control.chevronRef as Ref<HTMLButtonElement>}
    />
  );
}

/**
 * The Mic settings popover, anchored to its card (the Capture page) or its cell (the capture
 * widget).
 */
export function MicPanelPopover({
  control,
  on,
  isRecording,
  ui,
  ...devices
}: MicDevices & {
  control: AudioControl;
  on: boolean;
  isRecording: boolean;
  ui?: UiAreaProps;
}): React.JSX.Element | null {
  const t = useTranslations("micSettings");
  return (
    <SettingsPopover
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      anchorRef={control.chevronRef}
      onClose={control.close}
      ui={ui}
    >
      <MicSettingsBody control={control} micOn={on} isRecording={isRecording} {...devices} />
    </SettingsPopover>
  );
}

// ── System audio ────────────────────────────────────────────────────────────

interface AudioTileProps {
  on: boolean;
  onToggle: () => void;
  /** Mid-take with no loopback track: the body cannot turn it on; the settings still open. */
  unavailable?: boolean;
  compact?: boolean;
  /** The Capture page's setup card instead of the tile. */
  card?: boolean;
  control: AudioControl;
  ui?: UiAreaProps;
}

export function SystemAudioToggleSplit({
  control,
  on,
  onToggle,
  unavailable = false,
  compact,
  card = false,
  ui,
}: AudioTileProps): React.JSX.Element {
  const t = useTranslations("systemAudioSettings");
  const tRecord = useTranslations("record");
  if (card) {
    return (
      <SetupCard
        icon={Volume2}
        name={t("systemAudio")}
        detail={t("allSound")}
        status={on ? tRecord("statusOn") : tRecord("statusOff")}
        on={on}
        onToggle={onToggle}
        ui={ui}
        switchUnavailable={unavailable}
        switchTitle={unavailable ? tRecord("audioUnavailable") : undefined}
        chevronLabel={t("title")}
        open={control.open}
        onOpenChange={control.setOpen}
        controlsId={control.settingsId}
        chevronRef={control.chevronRef as Ref<HTMLButtonElement>}
      />
    );
  }
  return (
    <ToggleSplit
      icon={Volume2}
      label={tRecord("audioLabel")}
      status={on ? tRecord("statusOn") : tRecord("statusOff")}
      on={on}
      onToggle={onToggle}
      ui={ui}
      bodyUnavailable={unavailable}
      bodyTitle={unavailable ? tRecord("audioUnavailable") : undefined}
      chevronLabel={t("title")}
      compact={compact}
      open={control.open}
      onOpenChange={control.setOpen}
      controlsId={control.settingsId}
      chevronRef={control.chevronRef as Ref<HTMLButtonElement>}
    />
  );
}

/** The Audio settings popover, anchored to its card. */
export function SystemAudioPanelPopover({
  control,
  micOn,
  ui,
}: {
  control: AudioControl;
  micOn: boolean;
  ui?: UiAreaProps;
}): React.JSX.Element | null {
  const t = useTranslations("systemAudioSettings");
  return (
    <SettingsPopover
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      anchorRef={control.chevronRef}
      onClose={control.close}
      ui={ui}
    >
      <SystemAudioSettingsContent
        audio={control.store.audio}
        onChange={control.store.update}
        micOn={micOn}
      />
    </SettingsPopover>
  );
}
