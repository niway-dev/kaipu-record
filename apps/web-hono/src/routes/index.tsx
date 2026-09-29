import { createFileRoute } from "@tanstack/react-router";

import { HomeShell } from "@/components/home/home-shell";
import { Hero } from "@/components/home/hero";
import { Moments } from "@/components/home/moments";
import { pageHead, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  // The redesigned home brings its own chrome (top bar + rail), so the root
  // document must stand down exactly as it does for the marketing shell.
  staticData: { shell: "marketing" },
  head: ({ match }) => {
    const { locale } = match.context;
    return {
      ...pageHead({ locale, path: "/" }),
      scripts: [{ type: "application/ld+json", children: softwareJsonLd(locale) }],
    };
  },
  component: HomePage,
});

function HomePage() {
  return (
    <HomeShell>
      <Hero />
      <Moments />
    </HomeShell>
  );
}
