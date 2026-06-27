import { describe, expect, it } from "vitest";
import { buildExceptionProperties } from "./analytics.service";

describe("buildExceptionProperties", () => {
  it("tags every exception with product + surface and the origin", () => {
    const props = buildExceptionProperties("main-process", { foo: "bar" });
    expect(props.product).toBe("kaipu-recorder");
    expect(props.surface).toBe("desktop");
    expect(props.origin).toBe("main-process");
    expect(props.foo).toBe("bar");
  });
});
