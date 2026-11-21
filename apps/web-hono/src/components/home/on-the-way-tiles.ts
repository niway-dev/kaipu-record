import { Camera, Droplet, LayoutGrid, Ruler, ScanText, type LucideIcon } from "lucide-react";

import type { RoadmapItemId } from "@/components/roadmap/roadmap-config";

/**
 * The "On the way" tiles. Each one is a row of the public roadmap, and its badge is that
 * row's macOS state, read at render time. That is the brand rule made structural: a tile
 * cannot say "Private beta" or "Planned" on its own, so it cannot drift from the roadmap
 * and a planned feature cannot read as available.
 *
 * Measure and Pick colors are two tiles over one roadmap row (Inspect covers both).
 */
export const ON_THE_WAY_TILES = [
  {
    id: "ocr",
    roadmapId: "textRecognition",
    icon: ScanText,
    title: "homeOnTheWayOcrTitle",
    body: "homeOnTheWayOcrBody",
  },
  {
    id: "measure",
    roadmapId: "imageInspect",
    icon: Ruler,
    title: "homeOnTheWayMeasureTitle",
    body: "homeOnTheWayMeasureBody",
  },
  {
    id: "colors",
    roadmapId: "imageInspect",
    icon: Droplet,
    title: "homeOnTheWayColorsTitle",
    body: "homeOnTheWayColorsBody",
  },
  {
    id: "grid",
    roadmapId: "imageCanvas",
    icon: LayoutGrid,
    title: "homeOnTheWayGridTitle",
    body: "homeOnTheWayGridBody",
  },
  {
    id: "camera",
    roadmapId: "cameraMoves",
    icon: Camera,
    title: "homeOnTheWayCameraTitle",
    body: "homeOnTheWayCameraBody",
  },
] as const satisfies readonly {
  id: string;
  roadmapId: RoadmapItemId;
  icon: LucideIcon;
  title: string;
  body: string;
}[];
