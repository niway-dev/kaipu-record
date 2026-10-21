import { createFileRoute } from "@tanstack/react-router";

import { LazyHydrate } from "@/components/lazy-hydrate";
import { HomeShell } from "@/components/home/home-shell";
import { Files } from "@/components/home/files";
import { Closing } from "@/components/home/closing";
import { FEATURE_CHAPTERS } from "@/components/features/features-config";
import {
  ComingNext,
  FeatureChapterSection,
  FeaturesHero,
  PrivateByDesign,
} from "@/components/features/features-page";
import { pageHead } from "@/lib/seo";

/**
 * The full catalogue the home links to: every shipped feature, grouped by the
 * home's four chapters. Design: Claude Design project 71546ef1, file
 * `Kaipu Features.dc.html`. Content lives in features-config.ts.
 */
export const Route = createFileRoute("/features")({
  // Same chrome as the home (top bar + chapter rail), so the root document
  // stands down exactly as it does for the home.
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({ locale: match.context.locale, page: "features", path: "/features" }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <HomeShell page="features">
      <FeaturesHero />
      {FEATURE_CHAPTERS.map((chapter) => (
        <LazyHydrate key={chapter.id}>
          <FeatureChapterSection chapter={chapter} />
        </LazyHydrate>
      ))}
      <LazyHydrate>
        <Files />
      </LazyHydrate>
      <LazyHydrate>
        <PrivateByDesign />
      </LazyHydrate>
      <LazyHydrate>
        <ComingNext />
      </LazyHydrate>
      <LazyHydrate>
        <Closing />
      </LazyHydrate>
    </HomeShell>
  );
}
