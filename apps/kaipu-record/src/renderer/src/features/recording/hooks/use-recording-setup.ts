import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@shared/types";
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
} from "@renderer/features/recording/hooks/use-screen-recorder";
import type { Microphone, SelectedSource } from "@renderer/features/recording/types";

export interface RecordingSetupOptions {
  /** Fires when a recording finishes saving — the Record page uses it to navigate. */
  onRecordingComplete?: (recording: LocalRecording) => void;
}

const COUNTDOWN_SECONDS = 3;

/**
 * Smart container for the recording controls. Holds all the UI state the Record
 * page and the Capture Panel need, so both can render dumb components against the
 * same shape. Each consumer (separate windows) gets its own instance — this is
 * shared *code*, not shared *state*.
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
  stopRecording(): void;
  /** Stop if recording, otherwise start (with the same countdown). */
  toggleRecording(): void;
  pauseRecording(): void;
  resumeRecording(): void;
}

export function useRecordingSetup(options: RecordingSetupOptions = {}): RecordingSetup {
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

  // Per-window UI + recording lifecycle (NOT shared).
  const [isSourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [isMicrophoneMenuOpen, setMicrophoneMenuOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const microphones = useMicrophones();
  const recorder = useScreenRecorder({ onComplete: options.onRecordingComplete });

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

  // Recording lives in the real engine; "recording" and "paused" both count as
  // an active session for the UI.
  const isRecording = recorder.status === "recording" || recorder.status === "paused";

  const clearCountdown = useCallback(() => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    setCountdown(null);
  }, []);

  const startRecording = useCallback(() => {
    if (countdownTimer.current || isRecording || !selectedSource) return;
    let remaining = COUNTDOWN_SECONDS;
    setCountdown(remaining);
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        const engineQuality = qualityToEngine(qualityRef.current);
        const wm = watermarkRef.current;
        void recorder.start({
          sourceId: selectedSource.id,
          sourceName: selectedSource.name,
          microphoneDeviceId: isMicrophoneEnabled ? (selectedMicrophone?.deviceId ?? null) : null,
          systemAudio: isSystemAudioEnabled,
          width: engineQuality.width,
          height: engineQuality.height,
          frameRate: engineQuality.frameRate,
          videoBitrate: engineQuality.videoBitrate,
          watermark: wm.enabled ? wm.config : null,
        });
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [
    isRecording,
    clearCountdown,
    selectedSource,
    isMicrophoneEnabled,
    selectedMicrophone,
    isSystemAudioEnabled,
    recorder,
  ]);

  const stopRecording = useCallback(() => {
    clearCountdown();
    void recorder.stop();
  }, [clearCountdown, recorder]);

  const toggleRecording = useCallback(() => {
    if (isRecording) void recorder.stop();
    else startRecording();
  }, [isRecording, recorder, startRecording]);

  // Stop the countdown if the consumer unmounts mid-count.
  useEffect(() => () => clearCountdown(), [clearCountdown]);

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
    countdown,
    canStartRecording: Boolean(selectedSource),
    startRecording,
    stopRecording,
    toggleRecording,
    pauseRecording: recorder.pause,
    resumeRecording: recorder.resume,
  };
}
