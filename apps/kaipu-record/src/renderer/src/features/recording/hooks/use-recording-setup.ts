import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@shared/types";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import { useScreenRecorder } from "@renderer/features/recording/hooks/use-screen-recorder";
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
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);
  const [isSourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [isMicrophoneEnabled, setMicrophoneEnabled] = useState(true);
  const [isSystemAudioEnabled, setSystemAudioEnabled] = useState(false);
  const [isCameraEnabled, setCameraEnabled] = useState(false);

  const microphones = useMicrophones();
  const recorder = useScreenRecorder({ onComplete: options.onRecordingComplete });
  const [selectedMicrophone, setSelectedMicrophone] = useState<Microphone | null>(null);
  // Default to the first device once enumerated; keep the choice valid as
  // devices are plugged/unplugged.
  useEffect(() => {
    setSelectedMicrophone((current) => {
      if (current && microphones.some((m) => m.deviceId === current.deviceId)) return current;
      return microphones[0] ?? null;
    });
  }, [microphones]);

  const [isMicrophoneMenuOpen, setMicrophoneMenuOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
        void recorder.start({
          sourceId: selectedSource.id,
          sourceName: selectedSource.name,
          microphoneDeviceId: isMicrophoneEnabled ? (selectedMicrophone?.deviceId ?? null) : null,
          systemAudio: isSystemAudioEnabled,
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
    selectSource: setSelectedSource,
    isSourcePickerOpen,
    openSourcePicker: () => setSourcePickerOpen(true),
    closeSourcePicker: () => setSourcePickerOpen(false),

    isMicrophoneEnabled,
    isSystemAudioEnabled,
    isCameraEnabled,
    toggleMicrophone: () => setMicrophoneEnabled((on) => !on),
    toggleSystemAudio: () => setSystemAudioEnabled((on) => !on),
    toggleCamera: () => setCameraEnabled((on) => !on),

    microphones,
    selectedMicrophone,
    isMicrophoneMenuOpen,
    toggleMicrophoneMenu: () => setMicrophoneMenuOpen((open) => !open),
    selectMicrophone: (microphone) => {
      setSelectedMicrophone(microphone);
      setMicrophoneMenuOpen(false);
    },

    isRecording,
    countdown,
    canStartRecording: Boolean(selectedSource),
    startRecording,
    stopRecording,
    toggleRecording,
    pauseRecording: recorder.pause,
    resumeRecording: recorder.resume,
  };
}
