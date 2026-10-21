import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { TagColor } from "@kaipu/domain/constants";
import type { TagSummary } from "@shared/types";
import { reportError } from "@renderer/features/analytics";

export interface Tags {
  /** Live tags, most used first. */
  tags: TagSummary[];
  byId: ReadonlyMap<string, TagSummary>;
  /** Create a tag; resolves to it, or to the existing tag when the name is taken. */
  create(name: string, color?: TagColor): Promise<TagSummary | null>;
  rename(id: string, name: string): Promise<void>;
  recolor(id: string, color: TagColor): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * The tag registry as the renderer sees it (ADR 0020). Main owns it; this hook
 * lists it, re-lists whenever the library changes (main broadcasts after every
 * tag write), and turns failures into the usual error toast.
 */
export function useTags(): Tags {
  const t = useTranslations("library");
  const [tags, setTags] = useState<TagSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      setTags(await window.electronAPI.listTags());
    } catch (error) {
      reportError(t("errorTags"), error, { context: { phase: "list-tags" } });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [refresh]);

  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const run = useCallback(
    async (phase: string, work: () => Promise<unknown>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        reportError(t("errorTags"), error, { context: { phase } });
      }
      await refresh();
    },
    [refresh],
  );

  const create = useCallback(
    async (name: string, color?: TagColor): Promise<TagSummary | null> => {
      try {
        const tag = await window.electronAPI.createTag(name, color);
        await refresh();
        return tag;
      } catch (error) {
        // The name is taken: hand back the tag that has it instead of failing.
        const existing = (await window.electronAPI.listTags()).find(
          (tag) => tag.name.toLowerCase() === name.trim().toLowerCase(),
        );
        if (existing) return existing;
        reportError(t("errorTags"), error, { context: { phase: "create-tag" } });
        return null;
      }
    },
    [refresh],
  );

  return {
    tags,
    byId,
    create,
    rename: (id, name) => run("rename-tag", () => window.electronAPI.renameTag(id, name)),
    recolor: (id, color) => run("recolor-tag", () => window.electronAPI.recolorTag(id, color)),
    remove: (id) => run("delete-tag", () => window.electronAPI.deleteTag(id)),
  };
}

/** The tags an item carries, in its order, skipping ids the registry no longer has. */
export function resolveTags(
  tagIds: readonly string[] | undefined,
  byId: ReadonlyMap<string, TagSummary>,
): TagSummary[] {
  return (tagIds ?? []).flatMap((id) => {
    const tag = byId.get(id);
    return tag ? [tag] : [];
  });
}
