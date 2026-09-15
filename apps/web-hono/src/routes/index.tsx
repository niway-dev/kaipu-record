import { createFileRoute } from "@tanstack/react-router";
import { LandingNav } from "@/components/landing/landing-nav";
import { Hero } from "@/components/landing/hero";
import { Showcase } from "@/components/landing/showcase";
import { WhyKaipu } from "@/components/landing/why-kaipu";
import { DownloadSection } from "@/components/landing/download-section";
import { Footer } from "@/components/landing/footer";
import { pageHead, SITE_TITLE, SOFTWARE_JSON_LD } from "@/lib/seo";
import { useLandingTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  head: () => {
    const head = pageHead({ title: SITE_TITLE, path: "/" });
    return {
      ...head,
      scripts: [{ type: "application/ld+json", children: SOFTWARE_JSON_LD }],
    };
  },
  component: LandingPage,
});

function LandingPage() {
  const theme = useLandingTheme();
  return (
    <div
      data-theme={theme === "light" ? "light" : undefined}
      className="min-h-screen bg-[var(--kaipu-bg-app)] text-[var(--kaipu-text-primary)]"
    >
      <LandingNav />
      <Hero />
      <Showcase />
      <WhyKaipu />
      <DownloadSection />
      <Footer />
    </div>
  );
}
