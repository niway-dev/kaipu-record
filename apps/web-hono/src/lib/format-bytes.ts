import { formatBytesDecimal } from "@kaipu/domain/constants";

function decimalSeparator(locale: string): string {
  const part = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal");
  return part?.value ?? ".";
}

/**
 * The decimal byte string desktop shows ("1.3 GB"), with the locale's decimal separator
 * ("1,3 GB" in Spanish). The rounding and units stay in `@kaipu/domain`, so the two apps
 * cannot disagree on a number.
 */
export function formatBytesForLocale(bytes: number, locale: string): string {
  return formatBytesDecimal(bytes).replace(".", decimalSeparator(locale));
}
