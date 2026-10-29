import { describe, expect, it } from "vitest";
import {
  STEM_MAX_CODE_POINTS,
  STEM_MAX_UTF8_BYTES,
  fileStemFromTitle,
  isReservedStem,
  isReservedWindowsName,
} from "./file-stem";
import { isPlainItemId } from "./library-vault";

describe("fileStemFromTitle", () => {
  it.each([
    ["Sprint demo", "Sprint demo"],
    ["Sprint demo: part 1/2?", "Sprint demo part 1 2"],
    ['a<b>c:d"e/f\\g|h?i*j', "a b c d e f g h i j"],
    ["tab\there\nnew\u0000null\u007fdel", "tab here new null del"],
    ["  lots   of    space  ", "lots of space"],
    ["one..two...three", "one.two.three"],
    ["../../etc/passwd", "etc passwd"],
    [".hidden", "hidden"],
    ["...dots", "dots"],
    ["trailing.", "trailing"],
    ["trailing dots and spaces . . ", "trailing dots and spaces"],
    ["Demo v1.2", "Demo v1.2"],
    ["Kaipu Recording 2026-10-29 at 13.51.00", "Kaipu Recording 2026-10-29 at 13.51.00"],
  ])("%j → %j", (title, stem) => {
    expect(fileStemFromTitle(title)).toBe(stem);
  });

  it.each(["CON", "prn", "Aux", "nul", "COM1", "com9", "LPT1", "lpt9"])(
    "prefixes the reserved Windows name %s",
    (name) => {
      expect(fileStemFromTitle(name)).toBe(`Kaipu ${name}`);
      expect(fileStemFromTitle(`${name}.v2`)).toBe(`Kaipu ${name}.v2`);
    },
  );

  it("does not treat names that merely start like a device as reserved", () => {
    expect(fileStemFromTitle("Console log")).toBe("Console log");
    expect(fileStemFromTitle("COM10")).toBe("COM10");
    expect(fileStemFromTitle("nullable")).toBe("nullable");
  });

  it("normalizes to NFC", () => {
    const nfd = "Café demo";
    expect(fileStemFromTitle(nfd)).toBe("Café demo");
  });

  it("caps at 100 code points without splitting an emoji", () => {
    expect(fileStemFromTitle("x".repeat(500))).toBe("x".repeat(STEM_MAX_CODE_POINTS));
    const emoji = fileStemFromTitle("😀".repeat(200))!;
    // Each emoji is 4 UTF-8 bytes: the byte cap (180) binds first, at 45.
    expect(emoji).toBe("😀".repeat(45));
    expect(Array.from(emoji).every((c) => c === "😀")).toBe(true);
  });

  it("caps at 180 UTF-8 bytes on CJK text", () => {
    const stem = fileStemFromTitle("録".repeat(100))!;
    expect(Buffer.byteLength(stem, "utf8")).toBeLessThanOrEqual(STEM_MAX_UTF8_BYTES);
    expect(stem).toBe("録".repeat(60));
  });

  it("re-trims a trailing space or dot left by the cap", () => {
    const title = `${"a".repeat(STEM_MAX_CODE_POINTS - 1)} tail`;
    expect(fileStemFromTitle(title)).toBe("a".repeat(STEM_MAX_CODE_POINTS - 1));
  });

  it.each(["", "   ", "...", " . .. ", "???", "///", "\u0000\u0001"])(
    "returns null when nothing usable is left (%j)",
    (title) => {
      expect(fileStemFromTitle(title)).toBeNull();
    },
  );

  it("always yields a plain, safe id", () => {
    const samples = [
      "../x",
      "a/../b",
      "..\\..\\c",
      ".",
      ". .",
      "a..",
      "..a..b..",
      "CON.txt",
      "名前/テスト",
      `${"é".repeat(150)}`,
      "‮mirror",
      "x".repeat(300) + "/..",
    ];
    for (const title of samples) {
      const stem = fileStemFromTitle(title);
      if (stem === null) continue;
      expect(isPlainItemId(stem)).toBe(true);
      expect(stem).not.toMatch(/[/\\]/);
      expect(stem).not.toContain("..");
      expect(stem).not.toMatch(/[\s.]$/);
    }
  });
});

describe("reserved stems (NIW2-560 review)", () => {
  it.each([
    ["Demo.edit", "Demo edit"],
    ["Demo.EDIT", "Demo EDIT"],
    ["Demo.cursor", "Demo cursor"],
    ["Demo.edit.meta", "Demo.edit meta"],
    ["tags", "Kaipu tags"],
    ["TAGS", "Kaipu TAGS"],
  ])("projects %j to a stem that owns no other stem's companion (%j)", (title, stem) => {
    expect(fileStemFromTitle(title)).toBe(stem);
    expect(isReservedStem(stem)).toBe(false);
  });

  it("flags companion-shaped and vault-owned names", () => {
    expect(isReservedStem("a.edit")).toBe(true);
    expect(isReservedStem("a.Cursor")).toBe(true);
    expect(isReservedStem("a.edit.meta")).toBe(true);
    expect(isReservedStem("Tags")).toBe(true);
    expect(isReservedStem("tags list")).toBe(false);
    expect(isReservedStem("edit")).toBe(false);
  });
});

describe("filesystem aliases (NIW2-560 second review)", () => {
  it.each([
    ["Demo.curſor", "Demo cursor"], // U+017F long s folds to "s" on APFS
    ["Demo.\uFF45\uFF44\uFF49\uFF54", "Demo edit"], // fullwidth ".edit" letters
    ["tagſ", "Kaipu tags"],
    ["\uFF54\uFF41\uFF47\uFF53", "Kaipu tags"], // fullwidth "tags"
    ["\u212Aaipu demo", "Kaipu demo"], // Kelvin sign
    ["\uFF24\uFF45\uFF4D\uFF4F", "Demo"], // fullwidth letters
    ["a\uFF0Fb\uFF1Ac", "a b c"], // fullwidth solidus and colon become forbidden ASCII
    ["one\u2025two", "one.two"], // two-dot leader expands to "..", then collapses
  ])("projects %j to a plain, unreserved stem (%j)", (title, stem) => {
    expect(fileStemFromTitle(title)).toBe(stem);
  });

  it("flags reserved names under any case fold a filesystem may apply", () => {
    expect(isReservedStem("tagſ")).toBe(true);
    expect(isReservedStem("x.curſor")).toBe(true);
    expect(isReservedStem("x.\uFF45\uFF44\uFF49\uFF54")).toBe(true);
    expect(isReservedStem("TAGS")).toBe(true);
  });
});

describe("isReservedWindowsName", () => {
  it("checks the segment before the first dot, case-insensitively", () => {
    expect(isReservedWindowsName("con")).toBe(true);
    expect(isReservedWindowsName("Con.v2")).toBe(true);
    expect(isReservedWindowsName("demo")).toBe(false);
    expect(isReservedWindowsName("demo.con")).toBe(false);
  });
});
