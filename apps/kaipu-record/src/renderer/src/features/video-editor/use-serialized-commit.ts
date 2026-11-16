import { useCallback, useLayoutEffect, useRef } from "react";

/** Runs one scene-composing task; the task calls `armRenderWait` right after its commit. */
export type SerializedCommit = <T>(run: (armRenderWait: () => void) => Promise<T>) => Promise<T>;

/**
 * Runs scene-composing tasks (a join, an image insert) one after another. Each task reads the
 * scene after its own awaits, and the previous task's commit only reaches
 * `controller.scene` once React has rendered it. A task that committed therefore calls
 * `armRenderWait` straight after the commit, and the next task starts only after that render,
 * otherwise it would compose from the old scene and replace the first task's result.
 *
 * Every task that commits to the same scene must go through one instance, or two kinds of task
 * can still overwrite each other. A task that throws does not stall the queue.
 */
export function useSerializedCommit(): SerializedCommit {
  // End of the tasks queued so far, and what the running one waits for after its commit.
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  const afterCommitRef = useRef<Promise<void> | null>(null);
  const renderWaitersRef = useRef<Array<() => void>>([]);
  // Runs after every render of the owner: the waiting task resumes on the scene just committed.
  useLayoutEffect(() => {
    for (const resolve of renderWaitersRef.current.splice(0)) resolve();
  });
  useLayoutEffect(
    () => () => {
      for (const resolve of renderWaitersRef.current.splice(0)) resolve();
    },
    [],
  );
  return useCallback(<T>(run: (armRenderWait: () => void) => Promise<T>): Promise<T> => {
    const job = tailRef.current.then(() => {
      afterCommitRef.current = null;
      return run(() => {
        afterCommitRef.current = new Promise<void>((resolve) => {
          renderWaitersRef.current.push(resolve);
        });
      });
    });
    // The caller gets its result right away; only the next task waits for the render.
    tailRef.current = job.then(
      () => afterCommitRef.current,
      () => undefined,
    );
    return job;
  }, []);
}
