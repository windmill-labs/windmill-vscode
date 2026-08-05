import * as vscode from "vscode";
import * as yaml from "yaml";
import { minimatch } from "minimatch";
import { fileExists, readTextFromUri } from "../utils/file-utils";
import { Codebase } from "../extension";

/** A single entry of the `workspaces` map in wmill.yaml. */
export type WorkspaceEntryConfig = {
  baseUrl?: string;
  /** Git branch this workspace is bound to. Defaults to the workspace name. */
  gitBranch?: string;
  /** Windmill workspace id. Defaults to the workspace name. */
  workspaceId?: string;
};

/** The `workspaces` map of wmill.yaml, keyed by workspace name. */
export type WorkspacesConfig = {
  [workspaceName: string]: WorkspaceEntryConfig;
};

// Deprecated aliases of `workspaces`, in the same priority order the CLI uses.
const LEGACY_WORKSPACES_KEYS = [
  "gitBranches",
  "environments",
  "git_branches",
] as const;

// Keys of the `workspaces` map that are not workspaces.
const RESERVED_WORKSPACE_KEYS = new Set(["commonSpecificItems"]);

/**
 * Read the workspaces map out of a parsed wmill.yaml, falling back to the
 * deprecated keys. Returns the raw map plus the key it came from, for logging.
 */
export function extractWorkspacesConfig(
  config: any
): { key: string; workspaces: WorkspacesConfig } | undefined {
  for (const key of ["workspaces", ...LEGACY_WORKSPACES_KEYS]) {
    const workspaces = config?.[key];
    if (workspaces && typeof workspaces === "object") {
      return { key, workspaces: workspaces as WorkspacesConfig };
    }
  }
  return undefined;
}

/** The git branch a workspace entry is bound to (defaults to its name). */
export function getEffectiveGitBranch(
  workspaceName: string,
  entry: WorkspaceEntryConfig
): string {
  return entry.gitBranch ?? workspaceName;
}

/** The Windmill workspace id of a workspace entry (defaults to its name). */
export function getEffectiveWorkspaceId(
  workspaceName: string,
  entry: WorkspaceEntryConfig
): string {
  return entry.workspaceId ?? workspaceName;
}

/**
 * Find the workspace entry bound to a git branch. In the legacy format the keys
 * were branch names and `gitBranch` was absent, so this handles both.
 */
export function findWorkspaceByGitBranch(
  workspaces: WorkspacesConfig | undefined,
  branchName: string
): [string, WorkspaceEntryConfig] | undefined {
  if (!workspaces) {
    return undefined;
  }
  for (const [name, entry] of Object.entries(workspaces)) {
    if (RESERVED_WORKSPACE_KEYS.has(name) || !entry || typeof entry !== "object") {
      continue;
    }
    if (getEffectiveGitBranch(name, entry) === branchName) {
      return [name, entry];
    }
  }
  return undefined;
}

export function findCodebase(
  path: string,
  codebases: {
    includes?: string | string[];
    excludes?: string | string[];
    assets?: {
      from: string;
      to: string;
    }[];
  }[]
):
  | {
      assets?: {
        from: string;
        to: string;
      }[];
    }
  | undefined {
  for (const c of codebases) {
    let included = false;
    let excluded = false;
    if (c.includes === undefined || c.includes === null) {
      included = true;
    }
    if (typeof c.includes === "string") {
      c.includes = [c.includes];
    }
    for (const r of c.includes ?? []) {
      if (included) {
        break;
      }
      if (minimatch(path, r)) {
        included = true;
      }
    }
    if (typeof c.excludes === "string") {
      c.excludes = [c.excludes];
    }
    for (const r of c.excludes ?? []) {
      if (minimatch(path, r)) {
        excluded = true;
      }
    }
    return included && !excluded ? c : undefined;
  }
  return undefined;
}

export async function loadConfigForPath(
  wmPath: string,
  rootPath: string,
  channel: vscode.OutputChannel
): Promise<{
  defaultTs: "deno" | "bun";
  codebases: any[];
  workspaces?: WorkspacesConfig;
  nonDottedPaths: boolean;
}> {
  let splittedSlash = wmPath.split("/");
  channel.appendLine("wmPath: " + wmPath + "|" + splittedSlash);
  let found = false;
  let defaultTs: "deno" | "bun" = "bun";
  let codebases: any[] = [];
  let workspaces: WorkspacesConfig | undefined = undefined;
  let nonDottedPaths = false;

  for (let i = 0; i < splittedSlash.length; i++) {
    const path = splittedSlash.slice(0, i).join("/") + "/wmill.yaml";
    channel.appendLine(
      "checking if " + path + " exists: " + i + " " + splittedSlash.length
    );
    let uriPath = vscode.Uri.parse(rootPath + "/" + path);
    if (await fileExists(uriPath)) {
      let content = await readTextFromUri(uriPath);
      let config = (yaml.parse(content) ?? {}) as any;
      defaultTs = config?.["defaultTs"] ?? "bun";
      codebases = config?.["codebases"] ?? [];
      const workspacesConfig = extractWorkspacesConfig(config);
      workspaces = workspacesConfig?.workspaces;
      nonDottedPaths = config?.["nonDottedPaths"] === true;
      channel.appendLine(
        path +
          " exists! defaultTs: " +
          defaultTs +
          ", codebases:" +
          JSON.stringify(codebases) +
          ", " +
          (workspacesConfig?.key ?? "workspaces") +
          ":" +
          JSON.stringify(workspaces) +
          ", nonDottedPaths:" +
          nonDottedPaths
      );
      found = true;
      break;
    }
  }

  if (!found) {
    codebases = [];
  }

  return { defaultTs, codebases, workspaces, nonDottedPaths };
}