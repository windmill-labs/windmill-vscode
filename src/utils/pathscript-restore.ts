/**
 * Tracks PathScript modules that were replaced with rawscripts for preview,
 * so they can be restored before sync-back to disk.
 */

interface ReplacedPathScript {
  originalValue: any;
  injectedContent: string;
}

// For AI agent tools, keyed by `${moduleId}:${toolId}`
interface ReplacedToolScript {
  originalToolValue: any;
  injectedContent: string;
}

export type PathScriptMap = Map<string, ReplacedPathScript | ReplacedToolScript>;

/**
 * Builds a map of module ID → original value for all PathScript modules,
 * BEFORE replaceAllPathScriptsWithLocal mutates them.
 * Must be called after parseYaml but before replacement.
 */
export function buildPathScriptMap(flowValue: any): PathScriptMap {
  const map: PathScriptMap = new Map();
  if (flowValue?.modules) {
    collectFromModules(flowValue.modules, map);
  }
  if (flowValue?.failure_module) {
    collectFromModules([flowValue.failure_module], map);
  }
  if (flowValue?.preprocessor_module) {
    collectFromModules([flowValue.preprocessor_module], map);
  }
  return map;
}

function collectFromModules(modules: any[], map: PathScriptMap) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    if (module.value.type === "script") {
      map.set(module.id, {
        originalValue: JSON.parse(JSON.stringify(module.value)),
        injectedContent: "", // filled after replacement
      });
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      collectFromModules(module.value.modules, map);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        collectFromModules(branch.modules, map);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        collectFromModules(branch.modules, map);
      }
      if (module.value.default) {
        collectFromModules(module.value.default, map);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        const tv = tool.value;
        if (tv?.tool_type === "flowmodule" && tv.type === "script") {
          const key = `${module.id}:${tool.id}`;
          map.set(key, {
            originalToolValue: JSON.parse(JSON.stringify(tv)),
            injectedContent: "",
          });
        }
      }
    }
  }
}

/**
 * After replaceAllPathScriptsWithLocal has mutated the flow, call this
 * to record what content was injected into each replaced module.
 */
export function recordInjectedContent(
  flowValue: any,
  map: PathScriptMap
) {
  if (flowValue?.modules) {
    recordFromModules(flowValue.modules, map);
  }
  if (flowValue?.failure_module) {
    recordFromModules([flowValue.failure_module], map);
  }
  if (flowValue?.preprocessor_module) {
    recordFromModules([flowValue.preprocessor_module], map);
  }
}

function recordFromModules(modules: any[], map: PathScriptMap) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    if (module.value.type === "rawscript" && map.has(module.id)) {
      const entry = map.get(module.id)! as ReplacedPathScript;
      entry.injectedContent = module.value.content;
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      recordFromModules(module.value.modules, map);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        recordFromModules(branch.modules, map);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        recordFromModules(branch.modules, map);
      }
      if (module.value.default) {
        recordFromModules(module.value.default, map);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        const key = `${module.id}:${tool.id}`;
        if (tool.value?.type === "rawscript" && map.has(key)) {
          const entry = map.get(key)! as ReplacedToolScript;
          entry.injectedContent = tool.value.content;
        }
      }
    }
  }
}

/**
 * Restores PathScript modules in a flow returned from the webview.
 * Only restores if the content was not modified by the user.
 */
export function restorePathScripts(flowValue: any, map: PathScriptMap) {
  if (flowValue?.modules) {
    restoreInModules(flowValue.modules, map);
  }
  if (flowValue?.failure_module) {
    restoreInModules([flowValue.failure_module], map);
  }
  if (flowValue?.preprocessor_module) {
    restoreInModules([flowValue.preprocessor_module], map);
  }
}

function restoreInModules(modules: any[], map: PathScriptMap) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    if (module.value.type === "rawscript" && map.has(module.id)) {
      const entry = map.get(module.id)! as ReplacedPathScript;
      if (module.value.content === entry.injectedContent) {
        // Content unchanged — restore to PathScript.
        // Preserve input_transforms from the returned module (user may have changed them).
        module.value = {
          ...entry.originalValue,
          input_transforms: module.value.input_transforms,
        };
      }
      // If content was changed by user, keep the rawscript as-is.
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      restoreInModules(module.value.modules, map);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        restoreInModules(branch.modules, map);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        restoreInModules(branch.modules, map);
      }
      if (module.value.default) {
        restoreInModules(module.value.default, map);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        const key = `${module.id}:${tool.id}`;
        if (tool.value?.type === "rawscript" && map.has(key)) {
          const entry = map.get(key)! as ReplacedToolScript;
          if (tool.value.content === entry.injectedContent) {
            tool.value = {
              ...entry.originalToolValue,
              input_transforms: tool.value.input_transforms,
            };
          }
        }
      }
    }
  }
}
