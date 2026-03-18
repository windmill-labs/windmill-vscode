/**
 * Tags PathScript modules that were replaced with rawscripts for preview,
 * and restores them before sync-back to disk.
 *
 * Uses a hidden `_originalPathScript` field on the module value itself,
 * which the Windmill iframe preserves through the round-trip.
 */

import { AiAgent, FlowModule, FlowModuleValue, FlowValue, PathScript } from "windmill-client";

const TAG_KEY = "_originalPathScript" as const;

/** A single element of AiAgent["tools"] */
type AiAgentTool = AiAgent["tools"][number];

/**
 * Hidden tag types for the snapshot/restore cycle.
 * These extend the official types with the `_originalPathScript` field
 * that carries original values through the iframe round-trip.
 */
type TaggedModule = FlowModule & { [TAG_KEY]?: PathScript };
type TaggedValue = FlowModuleValue & { [TAG_KEY]?: FlowModuleValue };
type TaggedTool = AiAgentTool & { [TAG_KEY]?: AiAgentTool["value"] };
type TaggedToolValue = AiAgentTool["value"] & { [TAG_KEY]?: AiAgentTool["value"] };

interface ModuleVisitor {
  onModule(module: TaggedModule): void;
  onTool(tool: TaggedTool): void;
}

/**
 * Recursively walks all modules in a flow, visiting leaf modules and AI agent tools.
 * Handles branchone, branchall, forloopflow, whileloopflow, and aiagent nesting.
 */
function walkModules(modules: TaggedModule[], visitor: ModuleVisitor) {
  for (const module of modules) {
    if (!module.value) {
      continue;
    }
    const val = module.value;
    if (val.type === "forloopflow" || val.type === "whileloopflow") {
      walkModules(val.modules, visitor);
    } else if (val.type === "branchall") {
      for (const branch of val.branches ?? []) {
        walkModules(branch.modules, visitor);
      }
    } else if (val.type === "branchone") {
      for (const branch of val.branches ?? []) {
        walkModules(branch.modules, visitor);
      }
      if (val.default) {
        walkModules(val.default, visitor);
      }
    } else if (val.type === "aiagent") {
      for (const tool of val.tools ?? []) {
        visitor.onTool(tool as TaggedTool);
      }
    } else {
      visitor.onModule(module);
    }
  }
}

function walkFlow(flowValue: FlowValue, visitor: ModuleVisitor) {
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
export function snapshotPathScripts(flowValue: FlowValue) {
  walkFlow(flowValue, {
    onModule(module) {
      if (module.value.type === "script") {
        module[TAG_KEY] = JSON.parse(JSON.stringify(module.value)) as PathScript;
      }
    },
    onTool(tool) {
      const tv = tool.value;
      if (tv && "tool_type" in tv && tv.tool_type === "flowmodule" && tv.type === "script") {
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
export function tagReplacedPathScripts(flowValue: FlowValue) {
  walkFlow(flowValue, {
    onModule(module) {
      if (module[TAG_KEY] && module.value.type === "rawscript") {
        (module.value as TaggedValue)[TAG_KEY] = module[TAG_KEY];
        delete module[TAG_KEY];
      } else if (module[TAG_KEY]) {
        // Module was snapshotted but not replaced (local file not found) — clean up
        delete module[TAG_KEY];
      }
    },
    onTool(tool) {
      const tv = tool.value;
      if (tool[TAG_KEY] && tv && "tool_type" in tv && tv.tool_type === "flowmodule" && tv.type === "rawscript") {
        (tv as TaggedToolValue)[TAG_KEY] = tool[TAG_KEY];
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
export function restorePathScripts(flowValue: FlowValue) {
  walkFlow(flowValue, {
    onModule(module) {
      const tagged = module.value as TaggedValue;
      if (tagged[TAG_KEY]) {
        module.value = tagged[TAG_KEY]!;
      }
    },
    onTool(tool) {
      const tagged = tool.value as TaggedToolValue | undefined;
      if (tagged?.[TAG_KEY]) {
        tool.value = tagged[TAG_KEY]!;
      }
    },
  });
}
