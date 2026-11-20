import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingSettings } from "@shared/types/ipc";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import type { Microphone } from "@renderer/features/recording/types";
import type { RecordingTogglesApi } from "./use-overlay-toggles";

/** The microphones the widget's Microphone chevron offers, and the one in use. */
export interface WidgetDevices {
  microphones: Microphone[];
  /** `null` is the system default. */
  microphoneId: string | null;
  selectMicrophone(id: string): void;
}

/**
 * The same choice as Home and the capture panel, written to the same place: the microphone
 * through the shared `RecordingSettings`. (The camera popover reads and writes
 * `AppSettings.cameraBubble` itself, through the camera settings store.)
 * Enumerating devices opens nothing by itself. But when every microphone label is blank,
 * `useMicrophones` falls back to a `getUserMedia` probe, which can briefly open the microphone
 * and show the OS permission prompt or indicator. While the overlay is on capture intent
 * (`enabled` false) it reads nothing and never probes. On record intent it may, including
 * after a switch from capture, because `enabled` follows the intent.
 */
export function useWidgetDevices(api: RecordingTogglesApi, enabled: boolean): WidgetDevices {
  const microphones = useMicrophones(enabled);
  const [selectedMicrophone, setSelectedMicrophone] =
    useState<RecordingSettings["selectedMicrophone"]>(null);
  // Counts every microphone change after mount (a choice or a broadcast), so a late first
  // read can tell it is older than what the window already shows.
  const microphoneRevision = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const revisionAtRequest = microphoneRevision.current;
    api
      .getRecordingSettings()
      .then((current) => {
        if (live && microphoneRevision.current === revisionAtRequest) {
          setSelectedMicrophone(current.selectedMicrophone);
        }
      })
      .catch(() => {});
    const unsubscribe = api.onRecordingSettingsChanged((current) => {
      microphoneRevision.current += 1;
      setSelectedMicrophone(current.selectedMicrophone);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api, enabled]);

  const selectMicrophone = useCallback(
    (id: string): void => {
      const microphone = microphones.find((candidate) => candidate.deviceId === id);
      if (!microphone) return;
      microphoneRevision.current += 1;
      setSelectedMicrophone(microphone);
      api.updateRecordingSettings({ selectedMicrophone: microphone });
    },
    [api, microphones],
  );

  return {
    microphones,
    microphoneId: selectedMicrophone?.deviceId ?? null,
    selectMicrophone,
  };
}
