/** Canonical origin of the public site; `www.kaipu.app` should redirect here. */
export const SITE_URL = "https://kaipu.app";

export const SITE_NAME = "Kaipu Record";
export const SITE_TITLE = "Kaipu Record — Graba tu pantalla, sin complicaciones";
export const SITE_DESCRIPTION =
  "Graba tu pantalla y cámara en alta calidad, directo en tu Mac. Edita, exporta y comparte. Privado, rápido y sin cuenta.";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Per-page title, description and canonical link for a public route's `head`. */
export function pageHead({
  title,
  description = SITE_DESCRIPTION,
  path,
}: {
  title: string;
  description?: string;
  path: string;
}) {
  const url = `${SITE_URL}${path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** Pages that must not appear in search results (auth, signed-in app). */
export const NOINDEX = { meta: [{ name: "robots", content: "noindex, nofollow" }] };

export const SOFTWARE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Niway S.A.C.",
      url: "https://niway.dev",
      email: "contacto@niway.dev",
    },
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: SITE_URL,
      image: OG_IMAGE,
      description: SITE_DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "macOS",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "Niway S.A.C." },
    },
  ],
});
