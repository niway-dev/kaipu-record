import { describe, it, expect } from "vitest";
import es from "../../messages/es.json";
import en from "../../messages/en.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function resolve(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
}

describe("es/en message parity", () => {
  const esKeys = flattenKeys(es as Record<string, unknown>);
  const enKeys = flattenKeys(en as Record<string, unknown>);

  it("every es key exists in en", () => {
    const missing = esKeys.filter((k) => !enKeys.includes(k));
    expect(missing, `Missing in en.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("every en key exists in es", () => {
    const extra = enKeys.filter((k) => !esKeys.includes(k));
    expect(extra, `Extra in en.json: ${extra.join(", ")}`).toEqual([]);
  });

  it("es has no empty values", () => {
    expect(esKeys.filter((k) => resolve(es, k) === "")).toEqual([]);
  });

  it("en has no empty values", () => {
    expect(enKeys.filter((k) => resolve(en, k) === "")).toEqual([]);
  });
});
