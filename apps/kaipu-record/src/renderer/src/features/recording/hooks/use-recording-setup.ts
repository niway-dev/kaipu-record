import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_QUALITY,
  qualityToEngine,
  sanitizeQuality,
  type RecordingQuality,
} from "@shared/recording-quality";
import {
  DEFAULT_AUDIO_SETTINGS,
  sanitizeAudioSettings,
  type AudioSettings,
} from "@shared/audio-settings";
import {
  DEFAULT_CAMERA_BUBBLE,
  sanitizeCameraBubble,
  type CameraBubbleSettings,
} from "@shared/camera-bubble";
import { webcamCaptureLines } from "@shared/webcam-track";
import { useWatermark } from "@renderer/features/watermark/use-watermark";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import {
  useScreenRecorder,
  type RecorderStatus,
  type StartInput,
} from "@renderer/features/recording/hooks/use-screen-recorder";
import type { AppSettings } from "@shared/types";
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
    area,
    update,
  } = settings;

  // Per-window UI state (NOT shared).
  const [isSourcePickerOpen, setSourcePickerOpen] = useState(false);

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

  // The audio settings (mic level, noise reduction, system volume, ducking) are persisted
  // app settings too. Read on mount, then kept current through `onSettingsChanged`, so a
  // level changed in the popover before pressing Record is the one the take starts with.
  const audioRef = useRef<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  // The bubble's camera, size and framing decide the webcam file's camera and lines (ADR 0037).
  const cameraBubbleRef = useRef<CameraBubbleSettings>(DEFAULT_CAMERA_BUBBLE);
  // The microphone the user picked last (AppSettings.microphone); `undefined` until read.
  const [preferredMicrophone, setPreferredMicrophone] = useState<
    AppSettings["microphone"] | undefined
  >(undefined);
  useEffect(() => {
    // A broadcast is newer than the initial read, which may resolve after it: once one has
    // arrived, the read must not overwrite it.
    let heardChange = false;
    void window.electronAPI.getSettings().then((appSettings) => {
      if (heardChange) return;
      audioRef.current = sanitizeAudioSettings(appSettings.audio);
      cameraBubbleRef.current = sanitizeCameraBubble(appSettings.cameraBubble);
      setPreferredMicrophone(appSettings.microphone ?? null);
    });
    return window.electronAPI.onSettingsChanged((appSettings) => {
      heardChange = true;
      audioRef.current = sanitizeAudioSettings(appSettings.audio);
      cameraBubbleRef.current = sanitizeCameraBubble(appSettings.cameraBubble);
      setPreferredMicrophone(appSettings.microphone ?? null);
    });
  }, []);

  // Watermark decision (free → on, paid/forced → off) — the single seam. Kept in a
  // ref so the start callback reads the latest without re-subscribing.
  const watermark = useWatermark();
  const watermarkRef = useRef(watermark);
  watermarkRef.current = watermark;

  // The mic a take uses: the one the user picked, while it is connected; otherwise the
  // system's default input, which heads the list. Recomputed when devices come and go, so
  // unplugging the picked mic falls back and plugging it back in returns to it. Waits for
  // main's settings (before them `selectedMicrophone` is a placeholder) and never switches
  // while a take is pending or running.
  const settingsLoaded = settings.loaded;
  const recorderIdle = recorder.status === "idle";
  useEffect(() => {
    if (!settingsLoaded || preferredMicrophone === undefined || !recorderIdle) return;
    const effective =
      microphones.find((mic) => mic.deviceId === preferredMicrophone?.deviceId) ?? microphones[0];
    if (effective && effective.deviceId !== selectedMicrophone?.deviceId) {
      update({ selectedMicrophone: effective });
    }
  }, [settingsLoaded, preferredMicrophone, recorderIdle, microphones, selectedMicrophone, update]);

  // "Recording" and "paused" both count as an active session for the UI.
  const isRecording = recorder.status === "recording" || recorder.status === "paused";

  const sourceRef = useRef(selectedSource);
  sourceRef.current = selectedSource;
  const areaRef = useRef(area);
  areaRef.current = area;
  const micEnabledRef = useRef(isMicrophoneEnabled);
  micEnabledRef.current = isMicrophoneEnabled;
  const micRef = useRef(selectedMicrophone);
  micRef.current = selectedMicrophone;
  const systemAudioRef = useRef(isSystemAudioEnabled);
  systemAudioRef.current = isSystemAudioEnabled;
  const cameraEnabledRef = useRef(isCameraEnabled);
  cameraEnabledRef.current = isCameraEnabled;

  const startRecording = useCallback(() => {
    if (recorder.status !== "idle" || !sourceRef.current) return;
    recorder.requestStart((): StartInput => {
      const source = sourceRef.current;
      if (!source) throw new Error("startRecording: no source selected");
      const engineQuality = qualityToEngine(qualityRef.current);
      const wm = watermarkRef.current;
      const { deviceId, ...bubble } = cameraBubbleRef.current;
      return {
        sourceId: source.id,
        sourceName: source.name,
        area: areaRef.current,
        microphoneDeviceId: micEnabledRef.current ? (micRef.current?.deviceId ?? null) : null,
        systemAudio: systemAudioRef.current,
        audio: audioRef.current,
        width: engineQuality.width,
        height: engineQuality.height,
        frameRate: engineQuality.frameRate,
        videoBitrate: engineQuality.videoBitrate,
        watermark: wm.enabled ? wm.config : null,
        webcam: cameraEnabledRef.current
          ? { deviceId, lines: webcamCaptureLines(bubble), bubble }
          : null,
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
    // A source picked in the thumbnail picker is recorded whole: drop any area.
    selectSource: (source) => update({ selectedSource: source, area: null }),
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
    selectMicrophone: (microphone) => {
      // Only a pick is remembered. The fallback above is not: stored, it would replace the
      // pick, and the system's default would stop being followed. Written before the shared
      // selection, so no window sees the new selection with the old preference and undoes it.
      setPreferredMicrophone(microphone);
      void window.electronAPI.updateSettings({ microphone });
      update({ selectedMicrophone: microphone });
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
