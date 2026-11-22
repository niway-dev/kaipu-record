import { useCallback, useState, type HTMLAttributes } from "react";
import { useTranslations } from "@kaipu/i18n";

import {
  FULL_REGION,
  INITIAL_CLIP,
  type Clip,
  type Mark,
  type Region,
  type WorkspaceId,
} from "./hero-stage-model";
import type { HeroMode } from "./hero-modes";
import styles from "./hero-stage.module.css";
import { EditStage, type EditKind } from "./stage-edit";
import { ExportStage } from "./stage-export";
import { OverviewPreview } from "./stage-overview";
import { RecordStage } from "./stage-record";
import { ScreenshotStage } from "./stage-screenshot";
import { WorkspaceBar, type WorkspaceLock } from "./stage-parts";

/**
 * The hero's screen. One sample page (the hero itself) is what Record films,
 * Screenshot selects from, Edit annotates and trims, and Export packages, so a
 * visitor sees one thing pass through the four steps instead of four widgets.
 *
 * State that must survive a change of step lives here: the capture the editor
 * opens, the marks drawn on it and the clip's trim. Each step's own state
 * (the recording timer, a drag in progress) lives in the step and resets when
 * the visitor leaves it. On desktop the overview shows no screen at all; below
 * 1080px it shows a still picture of the product (`OverviewPreview`).
 */
export function HeroStage({
  mode,
  onMode,
  workspace,
  onWorkspace,
  onHold,
  stageProps,
}: {
  mode: HeroMode;
  onMode: (mode: HeroMode) => void;
  workspace: WorkspaceId;
  onWorkspace: (id: WorkspaceId) => void;
  /** A step's reason to keep the auto demo from moving on (see `useAutoDemo`). */
  onHold: (id: string, active: boolean) => void;
  /** Pointer and keyboard handlers that hold the auto demo while the visitor is on the screen. */
  stageProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const t = useTranslations("landing");
  const [lock, setLock] = useState<WorkspaceLock>(null);
  const menuHold = useCallback((open: boolean) => onHold("workspace-menu", open), [onHold]);
  const [capture, setCapture] = useState<Region>(FULL_REGION);
  const [fresh, setFresh] = useState(false);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [kind, setKind] = useState<EditKind>("image");
  const [clip, setClip] = useState<Clip>(INITIAL_CLIP);

  if (mode === "overview") {
    return (
      <div className={styles.slot}>
        <OverviewPreview t={t} />
      </div>
    );
  }

  const captured = (region: Region) => {
    setCapture(region);
    setMarks([]);
    setKind("image");
    setFresh(true);
    onMode("edit");
  };

  return (
    <div
      className={styles.stage}
      role="group"
      aria-label={t("homeStageScreen")}
      data-stage={mode}
      {...stageProps}
    >
      <WorkspaceBar
        t={t}
        workspace={workspace}
        onWorkspace={onWorkspace}
        lock={lock}
        onOpenChange={menuHold}
      />
      {mode === "record" && (
        <RecordStage
          t={t}
          workspace={workspace}
          onHold={onHold}
          onLock={setLock}
          onEdit={() => {
            setKind("video");
            onMode("edit");
          }}
        />
      )}
      {mode === "screenshot" && <ScreenshotStage t={t} onCapture={captured} onHold={onHold} />}
      {mode === "edit" && (
        <EditStage
          t={t}
          kind={kind}
          onKind={setKind}
          capture={capture}
          fresh={fresh}
          onFreshDone={() => setFresh(false)}
          marks={marks}
          onMarks={setMarks}
          clip={clip}
          onClip={setClip}
          onHold={onHold}
        />
      )}
      {mode === "export" && (
        <ExportStage
          t={t}
          kind={kind}
          capture={capture}
          marks={marks}
          clip={clip}
          workspace={workspace}
          onHold={onHold}
          onLock={setLock}
        />
      )}
    </div>
  );
}
