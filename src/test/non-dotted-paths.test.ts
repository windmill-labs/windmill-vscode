import {
  extractInlineScripts,
  newPathAssigner,
} from "windmill-utils-internal";
import { FlowModule } from "windmill-client";

/**
 * Helper to create a minimal FlowModule with an inline script.
 */
function makeInlineModule(
  id: string,
  language: string,
  content: string
): FlowModule {
  return {
    id,
    value: {
      type: "rawscript",
      language,
      content,
    },
  } as unknown as FlowModule;
}

describe("nonDottedPaths / skipInlineScriptSuffix", () => {
  describe("extractInlineScripts", () => {
    it("should use .inline_script. suffix by default", () => {
      const modules = [
        makeInlineModule("a", "bun", 'console.log("hello")'),
        makeInlineModule("b", "python3", 'print("hello")'),
      ];
      const result = extractInlineScripts(modules, {}, "/", "bun");
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "a.inline_script.ts" }),
          expect.objectContaining({ path: "b.inline_script.py" }),
        ])
      );
    });

    it("should use .inline_script. suffix when skipInlineScriptSuffix is false", () => {
      const modules = [
        makeInlineModule("a", "bun", 'console.log("hello")'),
      ];
      const result = extractInlineScripts(modules, {}, "/", "bun", undefined, {
        skipInlineScriptSuffix: false,
      });
      expect(result[0].path).toBe("a.inline_script.ts");
    });

    it("should NOT use .inline_script. suffix when skipInlineScriptSuffix is true", () => {
      const modules = [
        makeInlineModule("a", "bun", 'console.log("hello")'),
        makeInlineModule("b", "python3", 'print("hello")'),
      ];
      const result = extractInlineScripts(modules, {}, "/", "bun", undefined, {
        skipInlineScriptSuffix: true,
      });
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "a.ts" }),
          expect.objectContaining({ path: "b.py" }),
        ])
      );
    });

    it("should produce correct extensions regardless of suffix mode", () => {
      const modules1 = [
        makeInlineModule("x", "bun", "code"),
        makeInlineModule("y", "python3", "code"),
      ];
      const modules2 = [
        makeInlineModule("x", "bun", "code"),
        makeInlineModule("y", "python3", "code"),
      ];
      const withSuffix = extractInlineScripts(
        modules1,
        {},
        "/",
        "bun",
        undefined,
        { skipInlineScriptSuffix: false }
      );
      const withoutSuffix = extractInlineScripts(
        modules2,
        {},
        "/",
        "bun",
        undefined,
        { skipInlineScriptSuffix: true }
      );

      expect(withSuffix.some((s) => s.path.endsWith(".ts"))).toBe(true);
      expect(withSuffix.some((s) => s.path.endsWith(".py"))).toBe(true);
      expect(withoutSuffix.some((s) => s.path.endsWith(".ts"))).toBe(true);
      expect(withoutSuffix.some((s) => s.path.endsWith(".py"))).toBe(true);
    });

    it("should replace module content with !inline references matching file names", () => {
      const testModules: FlowModule[] = [
        makeInlineModule("step1", "bun", 'console.log("test")'),
      ];

      const result = extractInlineScripts(
        testModules,
        {},
        "/",
        "bun",
        undefined,
        { skipInlineScriptSuffix: true }
      );

      expect(result[0].path).toBe("step1.ts");

      // The module's content should have been replaced with !inline reference
      const module = testModules[0] as any;
      expect(module.value.content).toBe("!inline step1.ts");
    });

    it("should use .inline_script. in !inline references when suffix is not skipped", () => {
      const testModules: FlowModule[] = [
        makeInlineModule("step1", "bun", 'console.log("test")'),
      ];

      const result = extractInlineScripts(
        testModules,
        {},
        "/",
        "bun",
        undefined,
        { skipInlineScriptSuffix: false }
      );

      expect(result[0].path).toBe("step1.inline_script.ts");

      const module = testModules[0] as any;
      expect(module.value.content).toBe("!inline step1.inline_script.ts");
    });
  });

  describe("newPathAssigner", () => {
    it("should generate paths with .inline_script. suffix by default", () => {
      const assigner = newPathAssigner("bun");
      const [basePath, ext] = assigner.assignPath("step1", "bun" as any);
      expect(basePath).toBe("step1.inline_script.");
      expect(ext).toBe("ts");
    });

    it("should generate paths without .inline_script. suffix when skipInlineScriptSuffix is true", () => {
      const assigner = newPathAssigner("bun", {
        skipInlineScriptSuffix: true,
      });
      const [basePath, ext] = assigner.assignPath("step1", "bun" as any);
      expect(basePath).toBe("step1.");
      expect(ext).toBe("ts");
    });
  });
});

describe("determineLanguage with __flow paths", () => {
  const { determineLanguage } = require("../helpers");

  it('should return "flow" for .flow/flow.yaml paths', () => {
    expect(determineLanguage("path/to/x.flow/flow.yaml", "bun")).toBe("flow");
  });

  it('should return "flow" for __flow/flow.yaml paths', () => {
    expect(determineLanguage("path/to/x__flow/flow.yaml", "bun")).toBe("flow");
  });

  it("should return undefined for non-flow yaml", () => {
    expect(
      determineLanguage("path/to/file.yaml", "bun")
    ).toBeUndefined();
  });
});
