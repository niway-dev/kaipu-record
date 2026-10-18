import { createFileRoute } from "@tanstack/react-router";

import { LazyHydrate } from "@/components/lazy-hydrate";
import { HomeShell } from "@/components/home/home-shell";
import { Closing } from "@/components/home/closing";
import {
  RoadmapHero,
  RoadmapLegend,
  RoadmapList,
  WindowsComingSoon,
} from "@/components/roadmap/roadmap-page";
import { pageHead } from "@/lib/seo";

/**
 * What works today on each platform, and what comes next. Design: Claude Design
 * project 71546ef1, file `Kaipu Roadmap.dc.html`. Content lives in
 * roadmap-config.ts.
 */
export const Route = createFileRoute("/roadmap")({
  // Same top bar as the home and /features, so the root document stands down.
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({ locale: match.context.locale, page: "roadmap", path: "/roadmap" }),
  component: RoadmapPage,
});

function RoadmapPage() {
  return (
    // No chapter rail: this page has no chapters for it to scroll-spy on.
    <HomeShell page="roadmap" chapterNav={false}>
      <RoadmapHero />
      {/* Not lazy: the filters are the first thing a visitor touches. */}
      <RoadmapList />
      <RoadmapLegend />
      <LazyHydrate>
        <WindowsComingSoon />
      </LazyHydrate>
      <LazyHydrate>
        <Closing />
      </LazyHydrate>
    </HomeShell>
  );
}
