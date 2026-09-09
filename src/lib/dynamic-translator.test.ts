import { describe, expect, it } from "vitest";
import { dynamicTranslator } from "./dynamic-translator.ts";

describe("dynamicTranslator", () => {
  it("bridges a runtime catalogue key without discarding the resolved text contract", () => {
    const calls: unknown[][] = [];
    const translate = dynamicTranslator((...args: unknown[]) => {
      calls.push(args);
      return "resolved";
    });

    expect(translate("sheet.title", { name: "دانشجو" })).toBe("resolved");
    expect(calls).toEqual([["sheet.title", { name: "دانشجو" }]]);
  });

  it("rejects a non-callable or non-text translator result", () => {
    expect(() => dynamicTranslator({})).toThrow(TypeError);
    const translate = dynamicTranslator(() => 42);
    expect(() => translate("sheet.title")).toThrow(TypeError);
  });
});
