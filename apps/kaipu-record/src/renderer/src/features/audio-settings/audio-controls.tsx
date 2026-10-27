import React, { type Ref, type RefObject } from "react";
import { Mic, Volume2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import type { Microphone } from "@renderer/features/recording/types";
import { SettingsDrawer } from "../settings-controls/settings-drawer";
import { SettingsPopover } from "../settings-controls/settings-popover";
import { ToggleSplit } from "../settings-controls/toggle-split";
import {
  useSettingsDisclosure,
  type SettingsDisclosure,
} from "../settings-controls/use-settings-disclosure";
import { useSettingsFocus } from "../settings-controls/use-settings-focus";
import { MicSettingsContent } from "./mic-settings-content";
import { SystemAudioSettingsContent } from "./system-audio-settings-content";
import { spreadLevels, useMicLevelMeter } from "./use-mic-level-meter";
import { useAudioSettings, type AudioSettingsStore } from "./use-audio-settings";

/** State the Mic (or Audio) split tile and its settings (popover or drawer) share. */
export interface AudioControl extends SettingsDisclosure {
  store: AudioSettingsStore;
}

/** One per tile: each keeps its own throttled writer over the same persisted `audio`. */
export function useAudioControl(): AudioControl {
  const disclosure = useSettingsDisclosure();
  const store = useAudioSettings();
  return { ...disclosure, store };
}

const POPOVER_WIDTH = 300;

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
  compact?: boolean;
  firstRef: RefObject<HTMLElement | null>;
}

/**
 * The mic settings plus where their meter reads from. Mounted only while the popover or
 * drawer is open, so the pre-take meter (it opens the device) runs exactly that long: open,
 * mic on, not recording. During a take the engine's activity broadcast feeds it instead.
 */
function MicSettingsBody({
  control,
  micOn,
  isRecording,
  compact,
  firstRef,
  microphones,
  selectedMicrophone,
  onSelectMicrophone,
}: MicBodyProps): React.JSX.Element {
  const activity = useRecordingActivity();
  const preTake = useMicLevelMeter(
    selectedMicrophone?.deviceId ?? null,
    micOn && !isRecording && microphones.length > 0,
    control.store.audio.noiseSuppression,
  );
  const levels = isRecording ? spreadLevels(activity.micLevels) : preTake;
  return (
    <MicSettingsContent
      microphones={microphones}
      selected={selectedMicrophone}
      onSelect={onSelectMicrophone}
      audio={control.store.audio}
      onChange={control.store.update}
      isRecording={isRecording}
      levels={levels}
      compact={compact}
      firstRef={firstRef}
    />
  );
}

interface MicTileProps {
  on: boolean;
  onToggle: () => void;
  compact?: boolean;
  control: AudioControl;
}

export function MicToggleSplit({
  control,
  on,
  onToggle,
  compact,
}: MicTileProps): React.JSX.Element {
  const t = useTranslations("micSettings");
  const tRecord = useTranslations("record");
  return (
    <ToggleSplit
      icon={Mic}
      label={tRecord("micLabel")}
      status={on ? tRecord("statusOn") : tRecord("statusOff")}
      on={on}
      onToggle={onToggle}
      chevronLabel={t("title")}
      compact={compact}
      open={control.open}
      onOpenChange={control.setOpen}
      controlsId={control.settingsId}
      chevronRef={control.chevronRef as Ref<HTMLButtonElement>}
    />
  );
}

interface MicSettingsProps extends MicDevices {
  control: AudioControl;
  micOn: boolean;
  isRecording: boolean;
}

function MicSettingsPopover(props: MicSettingsProps): React.JSX.Element | null {
  const { control } = props;
  const t = useTranslations("micSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(control.open, control.chevronRef, control.close);
  return (
    <SettingsPopover
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      onClose={control.close}
      chevronRef={control.chevronRef}
      align="start"
      width={POPOVER_WIDTH}
      onKeyDown={onKeyDown}
    >
      <MicSettingsBody {...props} firstRef={firstRef} />
    </SettingsPopover>
  );
}

/** The Record page's Mic tile: the split toggle and its popover (`RecordingToggles`' `micSlot`). */
export function MicControlWithPopover({
  on,
  onToggle,
  isRecording,
  ...devices
}: MicDevices & { on: boolean; onToggle: () => void; isRecording: boolean }): React.JSX.Element {
  const control = useAudioControl();
  return (
    <>
      <MicToggleSplit control={control} on={on} onToggle={onToggle} />
      <MicSettingsPopover control={control} micOn={on} isRecording={isRecording} {...devices} />
    </>
  );
}

/** The capture panel's drawer, right under the row (in the panel's flow, so the panel grows). */
export function MicPanelDrawer({
  control,
  on,
  isRecording,
  ...devices
}: MicDevices & {
  control: AudioControl;
  on: boolean;
  isRecording: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("micSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(control.open, control.chevronRef, control.close);
  return (
    <SettingsDrawer
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      onKeyDown={onKeyDown}
    >
      <MicSettingsBody
        control={control}
        micOn={on}
        isRecording={isRecording}
        compact
        firstRef={firstRef}
        {...devices}
      />
    </SettingsDrawer>
  );
}

// ── System audio ────────────────────────────────────────────────────────────

interface AudioTileProps {
  on: boolean;
  onToggle: () => void;
  /** Mid-take with no loopback track: the body cannot turn it on; the settings still open. */
  unavailable?: boolean;
  compact?: boolean;
  control: AudioControl;
}

export function SystemAudioToggleSplit({
  control,
  on,
  onToggle,
  unavailable = false,
  compact,
}: AudioTileProps): React.JSX.Element {
  const t = useTranslations("systemAudioSettings");
  const tRecord = useTranslations("record");
  return (
    <ToggleSplit
      icon={Volume2}
      label={tRecord("audioLabel")}
      status={on ? tRecord("statusOn") : tRecord("statusOff")}
      on={on}
      onToggle={onToggle}
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

function SystemAudioSettingsPopover({
  control,
  micOn,
}: {
  control: AudioControl;
  micOn: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("systemAudioSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(control.open, control.chevronRef, control.close);
  return (
    <SettingsPopover
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      onClose={control.close}
      chevronRef={control.chevronRef}
      align="start"
      width={POPOVER_WIDTH}
      onKeyDown={onKeyDown}
    >
      <SystemAudioSettingsContent
        audio={control.store.audio}
        onChange={control.store.update}
        micOn={micOn}
        firstRef={firstRef}
      />
    </SettingsPopover>
  );
}

/** The Record page's Audio tile: the split toggle and its popover (`RecordingToggles`' `audioSlot`). */
export function SystemAudioControlWithPopover({
  on,
  onToggle,
  micOn,
  unavailable,
}: {
  on: boolean;
  onToggle: () => void;
  micOn: boolean;
  unavailable?: boolean;
}): React.JSX.Element {
  const control = useAudioControl();
  return (
    <>
      <SystemAudioToggleSplit
        control={control}
        on={on}
        onToggle={onToggle}
        unavailable={unavailable}
      />
      <SystemAudioSettingsPopover control={control} micOn={micOn} />
    </>
  );
}

export function SystemAudioPanelDrawer({
  control,
  micOn,
}: {
  control: AudioControl;
  micOn: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("systemAudioSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(control.open, control.chevronRef, control.close);
  return (
    <SettingsDrawer
      id={control.settingsId}
      label={t("title")}
      open={control.open}
      onKeyDown={onKeyDown}
    >
      <SystemAudioSettingsContent
        audio={control.store.audio}
        onChange={control.store.update}
        micOn={micOn}
        compact
        firstRef={firstRef}
      />
    </SettingsDrawer>
  );
}
