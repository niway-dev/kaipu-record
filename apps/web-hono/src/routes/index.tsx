import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/landing/public-shell";
import { Hero } from "@/components/landing/hero";
import { Showcase } from "@/components/landing/showcase";
import { WhyKaipu } from "@/components/landing/why-kaipu";
import { DownloadSection } from "@/components/landing/download-section";
import { pageHead, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  staticData: { shell: "marketing" },
  head: ({ match }) => {
    const { locale } = match.context;
    return {
      ...pageHead({ locale, path: "/" }),
      scripts: [{ type: "application/ld+json", children: softwareJsonLd(locale) }],
    };
  },
  component: LandingPage,
});

function LandingPage() {
  return (
    <PublicShell>
      <Hero />
      <Showcase />
      <WhyKaipu />
      <DownloadSection />
    </PublicShell>
  );
}
