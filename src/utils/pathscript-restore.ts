/**
 * Tags PathScript modules that were replaced with rawscripts for preview,
 * and restores them before sync-back to disk.
 *
 * Uses a hidden `_originalPathScript` field on the module value itself,
 * which the Windmill iframe preserves through the round-trip.
 */

const TAG_KEY = "_originalPathScript";

/**
 * After replaceAllPathScriptsWithLocal has mutated the flow, call this
 * to tag each replaced module with its original PathScript value.
 * Must be called AFTER replacement (modules are now rawscript).
 */
export function tagReplacedPathScripts(flowValue: any) {
  if (flowValue?.modules) {
    tagInModules(flowValue.modules);
  }
  if (flowValue?.failure_module) {
    tagInModules([flowValue.failure_module]);
  }
  if (flowValue?.preprocessor_module) {
    tagInModules([flowValue.preprocessor_module]);
  }
}

/**
 * Must be called BEFORE replaceAllPathScriptsWithLocal to snapshot
 * the original PathScript values onto each module.
 * After replacement, the tag moves into the rawscript value.
 */
export function snapshotPathScripts(flowValue: any) {
  if (flowValue?.modules) {
    snapshotInModules(flowValue.modules);
  }
  if (flowValue?.failure_module) {
    snapshotInModules([flowValue.failure_module]);
  }
  if (flowValue?.preprocessor_module) {
    snapshotInModules([flowValue.preprocessor_module]);
  }
}

function snapshotInModules(modules: any[]) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    if (module.value.type === "script") {
      // Snapshot the original value before replacement mutates it
      module[TAG_KEY] = JSON.parse(JSON.stringify(module.value));
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      snapshotInModules(module.value.modules);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        snapshotInModules(branch.modules);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        snapshotInModules(branch.modules);
      }
      if (module.value.default) {
        snapshotInModules(module.value.default);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        const tv = tool.value;
        if (tv?.tool_type === "flowmodule" && tv.type === "script") {
          tool[TAG_KEY] = JSON.parse(JSON.stringify(tv));
        }
      }
    }
  }
}

function tagInModules(modules: any[]) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    // If we snapshotted an original value and the module was replaced (now rawscript),
    // move the tag into module.value so it travels through the iframe round-trip
    if (module[TAG_KEY] && module.value.type === "rawscript") {
      module.value[TAG_KEY] = module[TAG_KEY];
      delete module[TAG_KEY];
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      tagInModules(module.value.modules);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        tagInModules(branch.modules);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        tagInModules(branch.modules);
      }
      if (module.value.default) {
        tagInModules(module.value.default);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        if (tool[TAG_KEY] && tool.value?.type === "rawscript") {
          tool.value[TAG_KEY] = tool[TAG_KEY];
          delete tool[TAG_KEY];
        }
      }
    }
  }
}

/**
 * Restores PathScript modules in a flow returned from the webview.
 * Any module with a `_originalPathScript` tag gets restored unconditionally.
 * The tag is removed after restoration.
 */
export function restorePathScripts(flowValue: any) {
  if (flowValue?.modules) {
    restoreInModules(flowValue.modules);
  }
  if (flowValue?.failure_module) {
    restoreInModules([flowValue.failure_module]);
  }
  if (flowValue?.preprocessor_module) {
    restoreInModules([flowValue.preprocessor_module]);
  }
}

function restoreInModules(modules: any[]) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    if (module.value[TAG_KEY]) {
      module.value = module.value[TAG_KEY];
    } else if (
      module.value.type === "forloopflow" ||
      module.value.type === "whileloopflow"
    ) {
      restoreInModules(module.value.modules);
    } else if (module.value.type === "branchall") {
      for (const branch of module.value.branches ?? []) {
        restoreInModules(branch.modules);
      }
    } else if (module.value.type === "branchone") {
      for (const branch of module.value.branches ?? []) {
        restoreInModules(branch.modules);
      }
      if (module.value.default) {
        restoreInModules(module.value.default);
      }
    } else if (module.value.type === "aiagent") {
      for (const tool of module.value.tools ?? []) {
        if (tool.value?.[TAG_KEY]) {
          tool.value = tool.value[TAG_KEY];
        }
      }
    }
  }
}
