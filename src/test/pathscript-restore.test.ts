import type { FlowValue } from "windmill-client";
import {
  snapshotPathScripts,
  tagReplacedPathScripts,
  restorePathScripts,
} from "../utils/pathscript-restore";

/** Helper: simulate what replaceAllPathScriptsWithLocal does to a module */
function simulateReplacement(
  module: any,
  content: string,
  language: string,
  lock?: string,
  tag?: string
) {
  const pathScript = module.value;
  module.value = {
    type: "rawscript",
    content,
    language,
    lock,
    path: pathScript.path,
    input_transforms: pathScript.input_transforms,
    tag: pathScript.tag_override ?? tag,
  };
}

function simulateToolReplacement(
  tool: any,
  content: string,
  language: string,
) {
  const toolValue = tool.value;
  tool.value = {
    tool_type: "flowmodule",
    type: "rawscript",
    content,
    language,
    path: toolValue.path,
    input_transforms: toolValue.input_transforms,
  };
}

function makeScriptModule(id: string, path: string, inputTransforms?: any): any {
  return {
    id,
    value: {
      type: "script",
      path,
      input_transforms: inputTransforms ?? { a: { type: "static", value: 1 } },
    },
  };
}

/** Simulate the full cycle: snapshot → replace → tag → (iframe round-trip) → restore */
function fullCycle(flowValue: any, replacements: [any, string, string][]) {
  snapshotPathScripts(flowValue);
  for (const [mod, content, lang] of replacements) {
    simulateReplacement(mod, content, lang);
  }
  tagReplacedPathScripts(flowValue);
  // Simulate iframe round-trip (JSON serialize/deserialize strips non-value fields)
  const roundTripped = JSON.parse(JSON.stringify(flowValue));
  restorePathScripts(roundTripped);
  return roundTripped;
}

describe("pathscript-restore", () => {
  describe("basic restore", () => {
    it("restores a PathScript module after round-trip", () => {
      const module = makeScriptModule("a", "f/test/helper_add");
      const flowValue = { modules: [module] };

      const result = fullCycle(flowValue, [[module, "export function main() {}", "bun"]]);

      expect(result.modules[0].value.type).toBe("script");
      expect(result.modules[0].value.path).toBe("f/test/helper_add");
      expect(result.modules[0].value.content).toBeUndefined();
    });

    it("preserves original input_transforms", () => {
      const module = makeScriptModule("a", "f/test/helper_add", {
        a: { type: "static", value: 99 },
      });
      const flowValue = { modules: [module] };

      const result = fullCycle(flowValue, [[module, "content", "bun"]]);

      expect(result.modules[0].value.type).toBe("script");
      expect(result.modules[0].value.input_transforms).toEqual({
        a: { type: "static", value: 99 },
      });
    });
  });

  describe("nested structures", () => {
    it("restores PathScripts inside branchone", () => {
      const innerModule = makeScriptModule("b", "f/test/helper_add");
      const defaultModule = makeScriptModule("c", "f/test/helper_greet");
      const flowValue = {
        modules: [
          {
            id: "a",
            value: {
              type: "branchone",
              branches: [{ expr: "true", modules: [innerModule] }],
              default: [defaultModule],
            },
          },
        ],
      };

      const result = fullCycle(flowValue, [
        [innerModule, "add content", "bun"],
        [defaultModule, "greet content", "python3"],
      ]);

      const branch = result.modules[0].value.branches[0].modules[0];
      const def = result.modules[0].value.default[0];
      expect(branch.value.type).toBe("script");
      expect(branch.value.path).toBe("f/test/helper_add");
      expect(def.value.type).toBe("script");
      expect(def.value.path).toBe("f/test/helper_greet");
    });

    it("restores PathScripts inside branchall", () => {
      const mod1 = makeScriptModule("b", "f/test/helper_add");
      const mod2 = makeScriptModule("c", "f/test/helper_upper");
      const flowValue = {
        modules: [
          {
            id: "a",
            value: {
              type: "branchall",
              branches: [{ modules: [mod1] }, { modules: [mod2] }],
            },
          },
        ],
      };

      const result = fullCycle(flowValue, [
        [mod1, "content1", "bun"],
        [mod2, "content2", "bun"],
      ]);

      expect(result.modules[0].value.branches[0].modules[0].value.type).toBe("script");
      expect(result.modules[0].value.branches[1].modules[0].value.type).toBe("script");
    });

    it("restores PathScripts inside forloopflow", () => {
      const inner = makeScriptModule("b", "f/test/helper_add");
      const flowValue = {
        modules: [{ id: "a", value: { type: "forloopflow", modules: [inner] } }],
      };

      const result = fullCycle(flowValue, [[inner, "content", "bun"]]);

      expect(result.modules[0].value.modules[0].value.type).toBe("script");
    });

    it("restores PathScripts inside whileloopflow", () => {
      const inner = makeScriptModule("b", "f/test/helper_add");
      const flowValue = {
        modules: [{ id: "a", value: { type: "whileloopflow", modules: [inner] } }],
      };

      const result = fullCycle(flowValue, [[inner, "content", "bun"]]);

      expect(result.modules[0].value.modules[0].value.type).toBe("script");
    });
  });

  describe("failure_module and preprocessor_module", () => {
    it("restores PathScripts in failure_module", () => {
      const failMod = makeScriptModule("fail", "f/test/helper_add");
      const flowValue = { modules: [], failure_module: failMod };

      snapshotPathScripts(flowValue);
      simulateReplacement(failMod, "content", "bun");
      tagReplacedPathScripts(flowValue);
      const result = JSON.parse(JSON.stringify(flowValue));
      restorePathScripts(result);

      expect(result.failure_module.value.type).toBe("script");
    });

    it("restores PathScripts in preprocessor_module", () => {
      const preMod = makeScriptModule("pre", "f/test/helper_add");
      const flowValue = { modules: [], preprocessor_module: preMod };

      snapshotPathScripts(flowValue);
      simulateReplacement(preMod, "content", "bun");
      tagReplacedPathScripts(flowValue);
      const result = JSON.parse(JSON.stringify(flowValue));
      restorePathScripts(result);

      expect(result.preprocessor_module.value.type).toBe("script");
    });
  });

  describe("AI agent tools", () => {
    it("restores PathScript tools in aiagent modules", () => {
      const tool: any = {
        id: "tool1",
        value: {
          tool_type: "flowmodule",
          type: "script",
          path: "f/test/helper_add",
          input_transforms: { a: { type: "static", value: 1 } },
        },
      };
      const flowValue = {
        modules: [{ id: "agent", value: { type: "aiagent", tools: [tool] } }],
      } as unknown as FlowValue;

      snapshotPathScripts(flowValue);
      simulateToolReplacement(tool, "tool content", "bun");
      tagReplacedPathScripts(flowValue);
      const result = JSON.parse(JSON.stringify(flowValue));
      restorePathScripts(result);

      expect(result.modules[0].value.tools[0].value.type).toBe("script");
      expect(result.modules[0].value.tools[0].value.tool_type).toBe("flowmodule");
      expect(result.modules[0].value.tools[0].value.path).toBe("f/test/helper_add");
    });
  });

  describe("modules not replaced", () => {
    it("does not touch rawscript modules that were not PathScripts", () => {
      const rawModule = {
        id: "a",
        value: { type: "rawscript", content: "inline content", language: "bun" },
      };
      const flowValue = { modules: [rawModule] } as unknown as FlowValue;

      // No PathScripts to snapshot, so snapshot/tag are no-ops
      snapshotPathScripts(flowValue);
      tagReplacedPathScripts(flowValue);
      const result = JSON.parse(JSON.stringify(flowValue));
      restorePathScripts(result);

      expect(result.modules[0].value.type).toBe("rawscript");
      expect(result.modules[0].value.content).toBe("inline content");
    });

    it("does not touch PathScript modules that were not replaced (not found locally)", () => {
      const mod1 = makeScriptModule("a", "f/test/helper_add");
      const mod2 = makeScriptModule("b", "f/test/not_found");
      const flowValue = { modules: [mod1, mod2] };

      snapshotPathScripts(flowValue);
      // Only mod1 gets replaced, mod2 stays as script
      simulateReplacement(mod1, "content", "bun");
      tagReplacedPathScripts(flowValue);
      const result = JSON.parse(JSON.stringify(flowValue));
      restorePathScripts(result);

      expect(result.modules[0].value.type).toBe("script");
      expect(result.modules[0].value.path).toBe("f/test/helper_add");
      expect(result.modules[1].value.type).toBe("script");
      expect(result.modules[1].value.path).toBe("f/test/not_found");
    });

    it("cleans up snapshot on unreplaced modules so it does not leak", () => {
      const mod = makeScriptModule("a", "f/test/not_found");
      const flowValue = { modules: [mod] };

      snapshotPathScripts(flowValue);
      // NOT replaced — stays as type: "script"
      tagReplacedPathScripts(flowValue);

      // The snapshot should be cleaned up from the module object
      expect((mod as any)._originalPathScript).toBeUndefined();
      // And not present in the value either
      expect((mod.value as any)._originalPathScript).toBeUndefined();
    });
  });

  describe("tag does not leak to disk", () => {
    it("restored module has no _originalPathScript field", () => {
      const module = makeScriptModule("a", "f/test/helper_add");
      const flowValue = { modules: [module] };

      const result = fullCycle(flowValue, [[module, "content", "bun"]]);

      expect(result.modules[0].value._originalPathScript).toBeUndefined();
    });
  });
});
