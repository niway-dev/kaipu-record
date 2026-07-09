import { createFileRoute } from "@tanstack/react-router";
import { LandingNav } from "@/components/landing/landing-nav";
import { Hero } from "@/components/landing/hero";
import { Showcase } from "@/components/landing/showcase";
import { WhyKaipu } from "@/components/landing/why-kaipu";
import { DownloadSection } from "@/components/landing/download-section";
import { Footer } from "@/components/landing/footer";
import { useLandingTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
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
