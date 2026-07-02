import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_QUALITY,
  qualityToEngine,
  sanitizeQuality,
  type RecordingQuality,
} from "@shared/recording-quality";
import { useWatermark } from "@renderer/features/watermark/use-watermark";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import {
  useScreenRecorder,
  type RecorderStatus,
  type StartInput,
} from "@renderer/features/recording/hooks/use-screen-recorder";
import type { Microphone, SelectedSource } from "@renderer/features/recording/types";

/**
 * Smart container for the recording controls. Holds all the UI state the Record
 * page and the Capture Panel need, so both can render dumb components against the
 * same shape. Each consumer (separate windows) gets its own instance — this is
 * shared *code*, not shared *state*. The recording lifecycle itself (countdown +
 * engine) is NOT local to this hook — see `use-screen-recorder.ts`.
 */
export interface RecordingSetup {
  // Source
  selectedSource: SelectedSource | null;
  selectSource(source: SelectedSource | null): void;
  isSourcePickerOpen: boolean;
  openSourcePicker(): void;
  closeSourcePicker(): void;

  // Capture toggles
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
  toggleMicrophone(): void;
  toggleSystemAudio(): void;
  toggleCamera(): void;

  // Microphone device
  microphones: Microphone[];
  selectedMicrophone: Microphone | null;
  isMicrophoneMenuOpen: boolean;
  toggleMicrophoneMenu(): void;
  selectMicrophone(microphone: Microphone): void;

  // Recording lifecycle
  isRecording: boolean;
  /** Full recorder status — `"starting"` covers the stream-acquire gap after the countdown. */
  recordingStatus: RecorderStatus;
  /** Current countdown tick (3→1) while a start is pending; null otherwise. */
  countdown: number | null;
  canStartRecording: boolean;
  /** Begin recording after a short countdown (used by the Record page). */
  startRecording(): void;
  /** Cancel a pending start, or stop an active recording — whichever applies. */
  stopRecording(): void;
  /** Stop if recording, otherwise start (with the same countdown). */
  toggleRecording(): void;
  pauseRecording(): void;
  resumeRecording(): void;
}

export function useRecordingSetup(): RecordingSetup {
  // Shared across windows (the main process is the source of truth), so toggling
  // a control in the Record page or the Capture Panel updates both.
  const settings = useRecordingSettings();
  const {
    selectedSource,
    selectedMicrophone,
    isMicrophoneEnabled,
    isSystemAudioEnabled,
    isCameraEnabled,
    update,
  } = settings;

  // Per-window UI state (NOT shared).
  const [isSourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [isMicrophoneMenuOpen, setMicrophoneMenuOpen] = useState(false);

  const microphones = useMicrophones();
  const recorder = useScreenRecorder();

  // The encoder quality is a persisted app setting (Settings page). Read it on
  // mount so it's available synchronously at start; kept in a ref so the start
  // callback never goes stale. Navigating Settings → Record remounts this hook,
  // so a just-changed quality is always picked up.
  const qualityRef = useRef<RecordingQuality>(DEFAULT_QUALITY);
  useEffect(() => {
    void window.electronAPI.getSettings().then((appSettings) => {
      qualityRef.current = sanitizeQuality(appSettings.recordingQuality);
    });
  }, []);

  // Watermark decision (free → on, paid/forced → off) — the single seam. Kept in a
  // ref so the start callback reads the latest without re-subscribing.
  const watermark = useWatermark();
  const watermarkRef = useRef(watermark);
  watermarkRef.current = watermark;

  // Default the mic to the first device once enumerated, into the shared settings
  // (idempotent — only when nothing is selected yet).
  useEffect(() => {
    if (!selectedMicrophone && microphones.length > 0) {
      update({ selectedMicrophone: microphones[0] });
    }
  }, [microphones, selectedMicrophone, update]);

  // "Recording" and "paused" both count as an active session for the UI.
  const isRecording = recorder.status === "recording" || recorder.status === "paused";

  const sourceRef = useRef(selectedSource);
  sourceRef.current = selectedSource;
  const micEnabledRef = useRef(isMicrophoneEnabled);
  micEnabledRef.current = isMicrophoneEnabled;
  const micRef = useRef(selectedMicrophone);
  micRef.current = selectedMicrophone;
  const systemAudioRef = useRef(isSystemAudioEnabled);
  systemAudioRef.current = isSystemAudioEnabled;

  const startRecording = useCallback(() => {
    if (recorder.status !== "idle" || !sourceRef.current) return;
    recorder.requestStart((): StartInput => {
      const source = sourceRef.current;
      if (!source) throw new Error("startRecording: no source selected");
      const engineQuality = qualityToEngine(qualityRef.current);
      const wm = watermarkRef.current;
      return {
        sourceId: source.id,
        sourceName: source.name,
        microphoneDeviceId: micEnabledRef.current ? (micRef.current?.deviceId ?? null) : null,
        systemAudio: systemAudioRef.current,
        width: engineQuality.width,
        height: engineQuality.height,
        frameRate: engineQuality.frameRate,
        videoBitrate: engineQuality.videoBitrate,
        watermark: wm.enabled ? wm.config : null,
      };
    });
  }, [recorder]);

  const stopRecording = useCallback(() => recorder.stopOrCancel(), [recorder]);

  const toggleRecording = useCallback(() => {
    if (isRecording) recorder.stopOrCancel();
    else startRecording();
  }, [isRecording, recorder, startRecording]);

  return {
    selectedSource,
    selectSource: (source) => update({ selectedSource: source }),
    isSourcePickerOpen,
    openSourcePicker: () => setSourcePickerOpen(true),
    closeSourcePicker: () => setSourcePickerOpen(false),

    isMicrophoneEnabled,
    isSystemAudioEnabled,
    isCameraEnabled,
    toggleMicrophone: () => update({ isMicrophoneEnabled: !isMicrophoneEnabled }),
    toggleSystemAudio: () => update({ isSystemAudioEnabled: !isSystemAudioEnabled }),
    toggleCamera: () => update({ isCameraEnabled: !isCameraEnabled }),

    microphones,
    selectedMicrophone,
    isMicrophoneMenuOpen,
    toggleMicrophoneMenu: () => setMicrophoneMenuOpen((open) => !open),
    selectMicrophone: (microphone) => {
      update({ selectedMicrophone: microphone });
      setMicrophoneMenuOpen(false);
    },

    isRecording,
    recordingStatus: recorder.status,
    countdown: recorder.countdown,
    // "idle" excludes counting/starting/recording/paused/finalizing in one
    // check, so a second start can never be requested while any phase of a
    // prior one — including the post-stop "Saving…" window — is in flight.
    canStartRecording: Boolean(selectedSource) && recorder.status === "idle",
    startRecording,
    stopRecording,
    toggleRecording,
    pauseRecording: recorder.pause,
    resumeRecording: recorder.resume,
  };
}
