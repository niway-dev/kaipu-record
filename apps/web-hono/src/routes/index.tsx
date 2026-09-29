import { createFileRoute } from "@tanstack/react-router";

import { HomeShell } from "@/components/home/home-shell";
import { Hero } from "@/components/home/hero";
import { pageHead, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  // The redesigned home brings its own chrome (the rail, no top nav), so the
  // root document must stand down exactly as it does for the marketing shell.
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
    </HomeShell>
  );
}
