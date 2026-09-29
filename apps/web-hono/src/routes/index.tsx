import { Crop, Scissors, Search, Video } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { HomeShell } from "@/components/home/home-shell";
import { Hero } from "@/components/home/hero";
import { Moments } from "@/components/home/moments";
import { Chapter } from "@/components/home/chapter";
import { MockRecord } from "@/components/home/mock-record";
import { MockCapture } from "@/components/home/mock-capture";
import { MockEdit } from "@/components/home/mock-edit";
import { MockFind } from "@/components/home/mock-find";
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
      <Chapter id="record" tint="c1" number="01" icon={Video} keyPrefix="homeChapter1">
        <MockRecord />
      </Chapter>
      <Chapter id="capture" tint="c2" number="02" icon={Crop} keyPrefix="homeChapter2">
        <MockCapture />
      </Chapter>
      <Chapter id="edit" tint="c3" number="03" icon={Scissors} keyPrefix="homeChapter3">
        <MockEdit />
      </Chapter>
      <Chapter id="find" tint="c4" number="04" icon={Search} keyPrefix="homeChapter4">
        <MockFind />
      </Chapter>
    </HomeShell>
  );
}
