import { getConfigDirPath } from "windmill-utils-internal";

// The CLI stores this under getStore("") — the config dir plus the hex of
// hash_string(""), which is 0 (see the CLI's core/store.ts).
const BRANCH_PROFILES_DIR = "0";
const BRANCH_PROFILES_FILE = "branch-profiles.json";

type BranchProfileMapping = {
  lastUsed?: {
    // key format: "<workspaceName>|<baseUrl>|<workspaceId>" -> profile name
    [key: string]: string;
  };
};

/**
 * Key of a remembered profile choice. Must match the CLI's
 * getBranchProfileKey (core/branch-profiles.ts), including the URL
 * normalization, or we'd look up entries the CLI never wrote.
 */
export function getBranchProfileKey(
  workspaceName: string,
  baseUrl: string,
  workspaceId: string
): string {
  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(baseUrl).toString();
  } catch {
    normalizedUrl = baseUrl;
  }
  return `${workspaceName}|${normalizedUrl}|${workspaceId}`;
}

/**
 * The profile the CLI last used for this workspace, when several profiles
 * share a remote and workspace id. Read-only: the CLI owns this file, and
 * following its choice keeps both tools on the same identity.
 *
 * Returns undefined when there is no remembered choice, the file is absent or
 * unreadable, or we're running in a web environment without file access.
 */
export async function getLastUsedProfile(
  workspaceName: string,
  baseUrl: string,
  workspaceId: string,
  configFolder?: string
): Promise<string | undefined> {
  if (typeof process === "undefined" || !process.versions || !process.versions.node) {
    return undefined;
  }

  try {
    const fs = await import("fs");
    const folder = configFolder && configFolder.length > 0 ? configFolder : undefined;
    const configDir = await getConfigDirPath(folder);
    const path = `${configDir}${BRANCH_PROFILES_DIR}/${BRANCH_PROFILES_FILE}`;

    const mapping = JSON.parse(fs.readFileSync(path, "utf8")) as BranchProfileMapping;
    return mapping?.lastUsed?.[getBranchProfileKey(workspaceName, baseUrl, workspaceId)];
  } catch (error) {
    // Missing file, invalid JSON, no read access: fall back to the caller's default
    return undefined;
  }
}
