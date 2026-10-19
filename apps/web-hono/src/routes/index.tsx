import { Crop, Scissors, Search, Video } from "lucide-react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { LazyHydrate } from "@/components/lazy-hydrate";
import { HomeShell } from "@/components/home/home-shell";
import { Hero } from "@/components/home/hero";
import { Moments } from "@/components/home/moments";
import { Kai } from "@/components/home/kai";
import { Chapter } from "@/components/home/chapter";
import { MockRecord } from "@/components/home/mock-record";
import { MockCapture } from "@/components/home/mock-capture";
import { MockEdit } from "@/components/home/mock-edit";
import { MockFind } from "@/components/home/mock-find";
import { Files } from "@/components/home/files";
import { Closing } from "@/components/home/closing";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/post-sign-in";
import { pageHead, softwareJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  // The redesigned home brings its own chrome (top bar + rail), so the root
  // document must stand down exactly as it does for the marketing shell.
  staticData: { shell: "marketing" },
  // A visitor with a valid session belongs on the dashboard. `getAuthSession` returns null without
  // calling the API when there is no session cookie (crawlers and first-time visitors), and for an
  // invalid or expired session, so those render the landing: no redirect loop, no forced login.
  beforeLoad: async () => {
    if (await getAuthSession()) {
      throw redirect({ href: DEFAULT_SIGNED_IN_PATH });
    }
  },
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
      {/* Everything below the hero hydrates lazily: its HTML is server-rendered
          and stays in the document, but its client work waits until the section
          is near the viewport. See LazyHydrate. */}
      <LazyHydrate>
        <Moments />
      </LazyHydrate>
      <LazyHydrate>
        <Kai />
      </LazyHydrate>
      <LazyHydrate>
        <Chapter id="record" tint="c1" number="01" icon={Video} keyPrefix="homeChapter1">
          <MockRecord />
        </Chapter>
      </LazyHydrate>
      <LazyHydrate>
        <Chapter id="capture" tint="c2" number="02" icon={Crop} keyPrefix="homeChapter2">
          <MockCapture />
        </Chapter>
      </LazyHydrate>
      <LazyHydrate>
        <Chapter id="edit" tint="c3" number="03" icon={Scissors} keyPrefix="homeChapter3">
          <MockEdit />
        </Chapter>
      </LazyHydrate>
      <LazyHydrate>
        <Chapter id="find" tint="c4" number="04" icon={Search} keyPrefix="homeChapter4">
          <MockFind />
        </Chapter>
      </LazyHydrate>
      <LazyHydrate>
        <Files />
      </LazyHydrate>
      <LazyHydrate>
        <Closing />
      </LazyHydrate>
    </HomeShell>
  );
}
