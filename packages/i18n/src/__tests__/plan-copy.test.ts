import { describe, expect, it } from "vitest";
import { planCopyValues } from "@kaipu/domain/constants";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/**
 * Plan copy (NIW2-232). UI strings interpolate the plan table from @kaipu/domain —
 * `t(key, planCopyValues())` — so they never hard-code a size. The legal text is the one
 * exception (it renders verbatim, and wording there is a legal decision), so this guard
 * pins its numbers to the same table instead.
 */
const values = planCopyValues();

const uiKeys = [
  ["settings", "accountDescription"],
  ["auth", "signUpSubtitle"],
  ["auth", "cloudPromotion"],
  ["auth", "cloudActivation"],
] as const;

type Catalog = Record<string, Record<string, string>>;
const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("plan copy", () => {
  for (const [ns, key] of uiKeys) {
    const enText = (en as unknown as Catalog)[ns]![key]!;
    const esText = (es as unknown as Catalog)[ns]![key]!;

    it(`${ns}.${key} interpolates sizes instead of hard-coding them`, () => {
      for (const text of [enText, esText]) {
        expect(text).not.toMatch(/\d\s?(MB|GB)\b/);
        expect(text).toContain("{freeCapacity}");
        for (const name of placeholders(text)) expect(Object.keys(values)).toContain(name);
      }
    });

    it(`${ns}.${key} uses the same placeholders in es and en`, () => {
      expect(placeholders(esText)).toEqual(placeholders(enText));
    });
  }

  it("the Cloud terms state the plan table's numbers", () => {
    for (const body of [en.legal.cloud.sections.offer.body, es.legal.cloud.sections.offer.body]) {
      expect(body).toContain(values.freeCapacity);
      expect(body).toContain(values.expansionCapacity);
      const sizes = [...body.matchAll(/\d+(?:[.,]\d+)?\s?(?:MB|GB)/g)].map((m) => m[0]);
      for (const size of sizes) {
        expect([values.freeCapacity, values.expansionCapacity]).toContain(size);
      }
    }
  });
});
