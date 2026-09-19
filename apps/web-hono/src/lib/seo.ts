import { DEFAULT_LOCALE, type Locale } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

/** Canonical origin of the public site; `www.kaipu.app` should redirect here. */
export const SITE_URL = "https://kaipu.app";

export const SITE_NAME = "Kaipu Record";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

/**
 * SEO copy is read straight from the message catalogs rather than through
 * `useTranslations`, because `head()` runs outside React — there is no provider
 * to read from at that point.
 */
const SEO = { es: es.seo, en: en.seo } as const;

/** Page ids with their own title and description in the `seo.pages` namespace. */
export type SeoPage = keyof typeof en.seo.pages;

function copyFor(locale: Locale) {
  return SEO[locale] ?? SEO[DEFAULT_LOCALE];
}

/** Open Graph locale tags, e.g. `es` → `es_PE` with `en_US` as the alternate. */
const OG_LOCALE: Record<Locale, string> = { es: "es_PE", en: "en_US" };

function ogLocales(locale: Locale) {
  const alternate = locale === "es" ? "en" : "es";
  return { current: OG_LOCALE[locale], alternate: OG_LOCALE[alternate] };
}

/**
 * Per-page title, description and canonical link for a public route's `head`.
 * Omit `page` for the site-level title (the landing page and the root document).
 */
export function pageHead({ locale, page, path }: { locale: Locale; page?: SeoPage; path: string }) {
  const copy = copyFor(locale);
  const title = page ? copy.pages[page].title : copy.siteTitle;
  const description = page ? copy.pages[page].description : copy.siteDescription;
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

/** The document-level meta every page inherits from the root route. */
export function siteHeadMeta(locale: Locale) {
  const copy = copyFor(locale);
  const og = ogLocales(locale);
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: copy.siteTitle },
    { name: "description", content: copy.siteDescription },
    { name: "application-name", content: SITE_NAME },
    { name: "theme-color", content: "#0b0b0d" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: og.current },
    { property: "og:locale:alternate", content: og.alternate },
    { property: "og:title", content: copy.siteTitle },
    { property: "og:description", content: copy.siteDescription },
    { property: "og:url", content: SITE_URL },
    { property: "og:image", content: OG_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: copy.siteTitle },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: copy.siteTitle },
    { name: "twitter:description", content: copy.siteDescription },
    { name: "twitter:image", content: OG_IMAGE },
  ];
}

/** Pages that must not appear in search results (auth, signed-in app). */
export const NOINDEX = { meta: [{ name: "robots", content: "noindex, nofollow" }] };

export function softwareJsonLd(locale: Locale) {
  return JSON.stringify({
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
        description: copyFor(locale).siteDescription,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "macOS",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@type": "Organization", name: "Niway S.A.C." },
      },
    ],
  });
}
