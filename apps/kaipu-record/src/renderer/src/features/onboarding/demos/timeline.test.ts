import { describe, expect, it } from "vitest";
import { SHARED_KEYFRAMES, createTimeline } from "./timeline";

describe("createTimeline", () => {
  it("K builds the mock's keyframe percentages and a running shorthand", () => {
    const tl = createTimeline();
    const anim = tl.K("x", 10, [
      [0, "opacity:0"],
      [2, "opacity:1"],
    ]);
    // Point 2 s of a 10 s loop = 20%; it starts blending .35 s earlier = 1.65 s = 16.50%;
    // the last value holds to 100%.
    expect(tl.css()).toBe(
      "@keyframes kd-x{0.00%{opacity:0}16.50%{opacity:0}20.00%{opacity:1}100%{opacity:1}}",
    );
    expect(anim).toBe("kd-x 10s cubic-bezier(.45,0,.2,1) infinite both");
  });

  it("K keeps the blend window clear of the previous point and honours tr and ease", () => {
    const tl = createTimeline();
    const anim = tl.K(
      "y",
      4,
      [
        [0, "a:0"],
        [1, "a:1"],
        [4, "a:2"],
      ],
      { tr: 5, ease: "linear" },
    );
    // tr larger than the gap: the blend starts .01 s after the previous point.
    // Between 1 s and 4 s it starts at max(1.01, -1) = 1.01 s = 25.25%.
    expect(tl.css()).toBe(
      "@keyframes kd-y{0.00%{a:0}0.25%{a:0}25.00%{a:1}25.25%{a:1}100.00%{a:2}}",
    );
    expect(anim).toBe("kd-y 4s linear infinite both");
  });

  it("freezes with a negative delay and paused", () => {
    const tl = createTimeline({ frozenAt: 8.5 });
    const anim = tl.K("rcur", 10, [[0, "a:0"]]);
    expect(anim).toBe("kd-rcur 10s cubic-bezier(.45,0,.2,1) -8.5s infinite both paused");
    expect(tl.ringK("rrg", 10, [1])).toBe("kd-rrg 10s ease-out -8.5s infinite both paused");
    expect(tl.vis("v", 10, 2)).toContain("-8.5s infinite both paused");
  });

  it("clamps the frozen time to T minus 0.05 s", () => {
    const tl = createTimeline({ frozenAt: 99 });
    expect(tl.K("z", 10, [[0, "a:0"]])).toContain(" -9.95s infinite both paused");
  });

  it("vis fades out when given an end, pops with a scale, and starts visible when a <= 0", () => {
    const tl = createTimeline();
    tl.vis("fade", 10, 2, 5);
    tl.vis("pop", 10, 2, null, true);
    tl.vis("start", 10, 0, 5);
    const css = tl.css();
    expect(css).toContain("@keyframes kd-fade{0.00%{opacity:0}");
    expect(css).toContain("50.00%{opacity:0}100%{opacity:0}}");
    expect(css).toContain("opacity:0;transform:scale(.6)");
    expect(css).toContain("@keyframes kd-start{0.00%{opacity:1}");
  });

  it("ringK pulses at each click second and prefixes the name", () => {
    const tl = createTimeline();
    const anim = tl.ringK("rg", 10, [1]);
    expect(tl.css()).toBe(
      "@keyframes kd-rg{0%{opacity:0;transform:scale(.3)}9.80%{opacity:0;transform:scale(.3)}" +
        "10.70%{opacity:.95;transform:scale(1)}12.60%{opacity:0;transform:scale(2.6)}" +
        "100%{opacity:0;transform:scale(2.6)}}",
    );
    expect(anim).toBe("kd-rg 10s ease-out infinite both");
  });

  it("turns names that are not valid CSS identifiers into valid ones", () => {
    const tl = createTimeline();
    expect(tl.K("ctl6.5", 10, [[0, "a:0"]])).toMatch(/^kd-ctl6_5 /);
    expect(tl.css()).toContain("@keyframes kd-ctl6_5{");
  });

  it("loop pauses the shared bar and blink animations when frozen", () => {
    expect(createTimeline().loop("kbnc", 0.5, "ease-in-out", 0.07)).toBe(
      "kd-kbnc 0.5s ease-in-out 0.07s infinite",
    );
    expect(createTimeline({ frozenAt: 3 }).loop("kbnc", 0.5, "ease-in-out", 0.07, 0.17)).toBe(
      "kd-kbnc 0.5s ease-in-out -0.17s infinite paused",
    );
    expect(SHARED_KEYFRAMES).toContain("@keyframes kd-kbnc");
    expect(SHARED_KEYFRAMES).toContain("@keyframes kd-kblink");
  });
});
