import { createFileRoute } from "@tanstack/react-router";
import { LandingNav } from "@/components/landing/landing-nav";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { DownloadSection } from "@/components/landing/download-section";
import { Footer } from "@/components/landing/footer";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--kaipu-bg-app)] text-[var(--kaipu-text-primary)]">
      <LandingNav />
      <Hero />
      <Features />
      <DownloadSection />
      <Footer />
    </div>
  );
}
