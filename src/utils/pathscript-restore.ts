/**
 * Tags PathScript modules that were replaced with rawscripts for preview,
 * and restores them before sync-back to disk.
 *
 * Uses a hidden `_originalPathScript` field on the module value itself,
 * which the Windmill iframe preserves through the round-trip.
 */

const TAG_KEY = "_originalPathScript";

interface ModuleVisitor {
  onModule(module: any): void;
  onTool(tool: any): void;
}

/**
 * Recursively walks all modules in a flow, visiting leaf modules and AI agent tools.
 * Handles branchone, branchall, forloopflow, whileloopflow, and aiagent nesting.
 */
function walkModules(modules: any[], visitor: ModuleVisitor) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    const type = module.value.type;
    if (type === "forloopflow" || type === "whileloopflow") {
      walkModules(module.value.modules, visitor);
    } else if (type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        walkModules(branch.modules, visitor);
      }
    } else if (type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        walkModules(branch.modules, visitor);
      }
      if (module.value.default) {
        walkModules(module.value.default, visitor);
      }
    } else if (type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        visitor.onTool(tool);
      }
    } else {
      visitor.onModule(module);
    }
  }
}

function walkFlow(flowValue: any, visitor: ModuleVisitor) {
  if (flowValue?.modules) {
    walkModules(flowValue.modules, visitor);
  }
  if (flowValue?.failure_module) {
    walkModules([flowValue.failure_module], visitor);
  }
  if (flowValue?.preprocessor_module) {
    walkModules([flowValue.preprocessor_module], visitor);
  }
}

/**
 * Must be called BEFORE replaceAllPathScriptsWithLocal to snapshot
 * the original PathScript values onto each module.
 * After replacement, the tag moves into the rawscript value.
 */
export function snapshotPathScripts(flowValue: any) {
  walkFlow(flowValue, {
    onModule(module) {
      if (module.value.type === "script") {
        module[TAG_KEY] = JSON.parse(JSON.stringify(module.value));
      }
    },
    onTool(tool) {
      const tv = tool.value;
      if (tv?.tool_type === "flowmodule" && tv.type === "script") {
        tool[TAG_KEY] = JSON.parse(JSON.stringify(tv));
      }
    },
  });
}

/**
 * After replaceAllPathScriptsWithLocal has mutated the flow, call this
 * to tag each replaced module with its original PathScript value.
 * Must be called AFTER replacement (modules are now rawscript).
 */
export function tagReplacedPathScripts(flowValue: any) {
  walkFlow(flowValue, {
    onModule(module) {
      if (module[TAG_KEY] && module.value.type === "rawscript") {
        module.value[TAG_KEY] = module[TAG_KEY];
        delete module[TAG_KEY];
      } else if (module[TAG_KEY]) {
        // Module was snapshotted but not replaced (local file not found) — clean up
        delete module[TAG_KEY];
      }
    },
    onTool(tool) {
      if (tool[TAG_KEY] && tool.value?.type === "rawscript") {
        tool.value[TAG_KEY] = tool[TAG_KEY];
        delete tool[TAG_KEY];
      } else if (tool[TAG_KEY]) {
        delete tool[TAG_KEY];
      }
    },
  });
}

/**
 * Restores PathScript modules in a flow returned from the webview.
 * Any module with a `_originalPathScript` tag gets restored unconditionally.
 * The tag is removed after restoration.
 */
export function restorePathScripts(flowValue: any) {
  walkFlow(flowValue, {
    onModule(module) {
      if (module.value[TAG_KEY]) {
        module.value = module.value[TAG_KEY];
      }
    },
    onTool(tool) {
      if (tool.value?.[TAG_KEY]) {
        tool.value = tool.value[TAG_KEY];
      }
    },
  });
}
