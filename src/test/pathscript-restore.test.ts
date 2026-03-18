import {
  buildPathScriptMap,
  recordInjectedContent,
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
  lock?: string,
  tag?: string
) {
  const toolValue = tool.value;
  tool.value = {
    tool_type: "flowmodule",
    type: "rawscript",
    content,
    language,
    lock,
    path: toolValue.path,
    input_transforms: toolValue.input_transforms,
    tag: toolValue.tag_override ?? tag,
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

describe("pathscript-restore", () => {
  describe("basic restore", () => {
    it("restores a PathScript module when content is unchanged", () => {
      const module = makeScriptModule("a", "f/test/helper_add");
      const flowValue = { modules: [module] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(module, "export function main() {}", "bun");
      recordInjectedContent(flowValue, map);

      // Simulate webview returning the same content
      restorePathScripts(flowValue, map);

      expect(module.value.type).toBe("script");
      expect(module.value.path).toBe("f/test/helper_add");
      expect((module.value as any).content).toBeUndefined();
    });

    it("does NOT restore when content was edited by user", () => {
      const module = makeScriptModule("a", "f/test/helper_add");
      const flowValue = { modules: [module] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(module, "export function main() {}", "bun");
      recordInjectedContent(flowValue, map);

      // User edits the content in the iframe
      module.value.content = "export function main() { return 42; }";

      restorePathScripts(flowValue, map);

      expect(module.value.type).toBe("rawscript");
      expect(module.value.content).toBe("export function main() { return 42; }");
    });
  });

  describe("input_transforms preservation", () => {
    it("preserves input_transforms changes on restore", () => {
      const module = makeScriptModule("a", "f/test/helper_add", {
        a: { type: "static", value: 1 },
      });
      const flowValue = { modules: [module] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(module, "content", "bun");
      recordInjectedContent(flowValue, map);

      // User changes input_transforms but not content
      module.value.input_transforms = {
        a: { type: "static", value: 99 },
        b: { type: "static", value: 50 },
      };

      restorePathScripts(flowValue, map);

      expect(module.value.type).toBe("script");
      expect(module.value.input_transforms).toEqual({
        a: { type: "static", value: 99 },
        b: { type: "static", value: 50 },
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

      const map = buildPathScriptMap(flowValue);
      expect(map.size).toBe(2);

      simulateReplacement(innerModule, "add content", "bun");
      simulateReplacement(defaultModule, "greet content", "python3");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(innerModule.value.type).toBe("script");
      expect(innerModule.value.path).toBe("f/test/helper_add");
      expect(defaultModule.value.type).toBe("script");
      expect(defaultModule.value.path).toBe("f/test/helper_greet");
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
              branches: [
                { modules: [mod1] },
                { modules: [mod2] },
              ],
            },
          },
        ],
      };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(mod1, "content1", "bun");
      simulateReplacement(mod2, "content2", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(mod1.value.type).toBe("script");
      expect(mod2.value.type).toBe("script");
    });

    it("restores PathScripts inside forloopflow", () => {
      const inner = makeScriptModule("b", "f/test/helper_add");
      const flowValue = {
        modules: [
          {
            id: "a",
            value: { type: "forloopflow", modules: [inner] },
          },
        ],
      };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(inner, "content", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(inner.value.type).toBe("script");
    });

    it("restores PathScripts inside whileloopflow", () => {
      const inner = makeScriptModule("b", "f/test/helper_add");
      const flowValue = {
        modules: [
          {
            id: "a",
            value: { type: "whileloopflow", modules: [inner] },
          },
        ],
      };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(inner, "content", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(inner.value.type).toBe("script");
    });
  });

  describe("mixed scenarios", () => {
    it("restores unedited modules but keeps edited ones", () => {
      const mod1 = makeScriptModule("a", "f/test/helper_add");
      const mod2 = makeScriptModule("b", "f/test/helper_upper");
      const flowValue = { modules: [mod1, mod2] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(mod1, "content1", "bun");
      simulateReplacement(mod2, "content2", "bun");
      recordInjectedContent(flowValue, map);

      // User edits mod2 but not mod1
      mod2.value.content = "edited content";

      restorePathScripts(flowValue, map);

      expect(mod1.value.type).toBe("script");
      expect(mod2.value.type).toBe("rawscript");
      expect(mod2.value.content).toBe("edited content");
    });

    it("ignores modules not in the map (new modules added by user)", () => {
      const original = makeScriptModule("a", "f/test/helper_add");
      const flowValue = { modules: [original] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(original, "content", "bun");
      recordInjectedContent(flowValue, map);

      // User adds a new rawscript module
      const newModule = {
        id: "z",
        value: {
          type: "rawscript",
          content: "new script",
          language: "bun",
        },
      };
      flowValue.modules.push(newModule);

      restorePathScripts(flowValue, map);

      expect(original.value.type).toBe("script");
      expect(newModule.value.type).toBe("rawscript");
      expect(newModule.value.content).toBe("new script");
    });

    it("handles deleted modules gracefully", () => {
      const mod1 = makeScriptModule("a", "f/test/helper_add");
      const mod2 = makeScriptModule("b", "f/test/helper_upper");
      const flowValue = { modules: [mod1, mod2] };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(mod1, "content1", "bun");
      simulateReplacement(mod2, "content2", "bun");
      recordInjectedContent(flowValue, map);

      // User deletes mod2
      flowValue.modules.splice(1, 1);

      restorePathScripts(flowValue, map);

      expect(flowValue.modules.length).toBe(1);
      expect(mod1.value.type).toBe("script");
    });
  });

  describe("failure_module and preprocessor_module", () => {
    it("restores PathScripts in failure_module", () => {
      const failMod = makeScriptModule("fail", "f/test/helper_add");
      const flowValue = {
        modules: [],
        failure_module: failMod,
      };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(failMod, "content", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(failMod.value.type).toBe("script");
    });

    it("restores PathScripts in preprocessor_module", () => {
      const preMod = makeScriptModule("pre", "f/test/helper_add");
      const flowValue = {
        modules: [],
        preprocessor_module: preMod,
      };

      const map = buildPathScriptMap(flowValue);
      simulateReplacement(preMod, "content", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(preMod.value.type).toBe("script");
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
        modules: [
          {
            id: "agent",
            value: { type: "aiagent", tools: [tool] },
          },
        ],
      };

      const map = buildPathScriptMap(flowValue);
      simulateToolReplacement(tool, "tool content", "bun");
      recordInjectedContent(flowValue, map);

      restorePathScripts(flowValue, map);

      expect(tool.value.type).toBe("script");
      expect(tool.value.tool_type).toBe("flowmodule");
      expect(tool.value.path).toBe("f/test/helper_add");
    });

    it("does NOT restore aiagent tool when content was edited", () => {
      const tool: any = {
        id: "tool1",
        value: {
          tool_type: "flowmodule",
          type: "script",
          path: "f/test/helper_add",
          input_transforms: {},
        },
      };
      const flowValue = {
        modules: [
          {
            id: "agent",
            value: { type: "aiagent", tools: [tool] },
          },
        ],
      };

      const map = buildPathScriptMap(flowValue);
      simulateToolReplacement(tool, "tool content", "bun");
      recordInjectedContent(flowValue, map);

      tool.value.content = "edited tool content";

      restorePathScripts(flowValue, map);

      expect(tool.value.type).toBe("rawscript");
    });
  });

  describe("PathScript not found locally (not replaced)", () => {
    it("does not add to map if module type is not script", () => {
      const module = {
        id: "a",
        value: {
          type: "rawscript",
          content: "already inline",
          language: "bun",
        },
      };
      const flowValue = { modules: [module] };

      const map = buildPathScriptMap(flowValue);
      expect(map.size).toBe(0);
    });

    it("handles script module that was not replaced (not found locally)", () => {
      const mod1 = makeScriptModule("a", "f/test/helper_add");
      const mod2 = makeScriptModule("b", "f/test/not_found_locally");
      const flowValue = { modules: [mod1, mod2] };

      const map = buildPathScriptMap(flowValue);
      // Only mod1 gets replaced, mod2 stays as script (not found locally)
      simulateReplacement(mod1, "content", "bun");
      // mod2 stays as type: "script" — recordInjectedContent won't find rawscript for it
      recordInjectedContent(flowValue, map);

      // Webview returns: mod1 as rawscript (from replacement), mod2 still as script
      restorePathScripts(flowValue, map);

      expect(mod1.value.type).toBe("script");
      // mod2 was never replaced, stays as script — map entry has empty injectedContent
      // but since mod2.value.type is still "script" (not "rawscript"), restore skips it
      expect(mod2.value.type).toBe("script");
    });
  });
});
