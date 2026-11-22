import { useEffect, useState } from "react";
import { Camera, CameraOff, Check, Mic, MicOff, Pause, Play, Square } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";

import { formatTime, workspaceFolder, type WorkspaceId } from "./hero-stage-model";
import styles from "./hero-stage.module.css";
import {
  SampleScreen,
  useWorkspaceLock,
  workspaceName,
  type T,
  type WorkspaceLock,
} from "./stage-parts";
import { useHold } from "./use-auto-demo";

type Phase = "recording" | "paused" | "stopped";

const LEVELS = [0.4, 0.9, 0.6, 1, 0.5];

/**
 * Record: the sample page is the recorded screen, Kai stands in for the
 * webcam in a corner and the recording bar sits at the bottom centre. Pause,
 * resume, stop, the microphone and the camera all work, on a local timer. No
 * real screen, camera or microphone is ever requested. The take is saved in the
 * active workspace's folder, and the workspace cannot change while it runs.
 */
export function RecordStage({
  t,
  workspace,
  onHold,
  onLock,
  onEdit,
}: {
  t: T;
  workspace: WorkspaceId;
  onHold: (id: string, active: boolean) => void;
  onLock: (lock: WorkspaceLock) => void;
  onEdit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("recording");
  const [seconds, setSeconds] = useState(0);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  // Where this take was written: the workspace at the moment of Stop, not whichever is active later.
  const [savedIn, setSavedIn] = useState<WorkspaceId>(workspace);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const stop = () => {
    setSavedIn(workspace);
    setPhase("stopped");
  };
  const again = () => {
    setSeconds(0);
    setPhase("recording");
  };
  const live = phase === "recording";
  // Pausing, or stopping to read the saved bar, means the visitor is here: the demo waits.
  useHold(onHold, "record", phase !== "recording");
  useWorkspaceLock(onLock, phase === "stopped" ? null : "recording");

  return (
    <div className={styles.screen}>
      <SampleScreen t={t} download />

      {camera && phase !== "stopped" && (
        <div className={styles.bubble} aria-hidden>
          <KaipuLogo use="product" size={120} className={styles.bubbleFox} />
        </div>
      )}

      <span className={styles.srOnly} role="status">
        {phase === "paused" ? t("homeStagePaused") : live ? t("homeStageRecording") : ""}
      </span>

      {phase === "stopped" ? (
        <div
          className={`${styles.dock} ${styles.dockSaved}`}
          role="group"
          aria-label={t("homeStageRecording")}
        >
          <span className={styles.done}>
            <Check size={14} aria-hidden />
          </span>
          <span className={styles.dockText}>
            {t("homeStageRecSaved", {
              folder: workspaceFolder(savedIn, workspaceName(t, savedIn)),
              time: formatTime(seconds),
            })}
          </span>
          <button type="button" className={styles.dockPrimary} onClick={onEdit}>
            {t("homeStageEditRecording")}
          </button>
          <button type="button" className={styles.dockBtn} onClick={again}>
            {t("homeStageRecordAgain")}
          </button>
        </div>
      ) : (
        <div className={styles.dock} role="group" aria-label={t("homeStageRecording")}>
          <span className={styles.timer} role="timer" aria-label={t("homeStageTimer")}>
            <span className={`${styles.recDot} ${live ? styles.recDotLive : ""}`} aria-hidden />
            {formatTime(seconds)}
          </span>
          <button
            type="button"
            className={`${styles.dockIcon} ${mic ? "" : styles.dockOff}`}
            aria-pressed={mic}
            aria-label={t("homeStageMic")}
            onClick={() => setMic((v) => !v)}
          >
            {mic ? <Mic size={16} aria-hidden /> : <MicOff size={16} aria-hidden />}
            <span className={styles.levels} aria-hidden>
              {LEVELS.map((h, i) => (
                <span
                  key={i}
                  className={`${styles.levelBar} ${mic && live ? "kl-anim-levels" : ""}`}
                  style={{
                    transform: `scaleY(${mic ? h : 0.2})`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </span>
          </button>
          <button
            type="button"
            className={`${styles.dockIcon} ${camera ? "" : styles.dockOff}`}
            aria-pressed={camera}
            aria-label={t("homeStageCamera")}
            onClick={() => setCamera((v) => !v)}
          >
            {camera ? <Camera size={16} aria-hidden /> : <CameraOff size={16} aria-hidden />}
          </button>
          <button
            type="button"
            className={styles.dockIcon}
            aria-label={live ? t("homeStagePause") : t("homeStageResume")}
            onClick={() => setPhase(live ? "paused" : "recording")}
          >
            {live ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <button
            type="button"
            className={`${styles.dockIcon} ${styles.stop}`}
            aria-label={t("homeStageStop")}
            onClick={stop}
          >
            <Square size={12} fill="currentColor" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
