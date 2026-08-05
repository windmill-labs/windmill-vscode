import * as vscode from "vscode";
import { getWorkspaceConfigFilePath, getActiveWorkspaceConfigFilePath } from "windmill-utils-internal";
import {
  WorkspacesConfig,
  findWorkspaceByGitBranch,
  getEffectiveWorkspaceId,
  loadConfigForPath,
} from "../config/config-manager";
import {
  getCurrentGitBranch,
  getOriginalBranchForWorkspaceForks,
  getWorkspaceIdForWorkspaceForkFromBranchName,
} from "../utils/git-utils";

let globalStatusBarItem: vscode.StatusBarItem | undefined = undefined;

type Workspace = {
  name: string;
  remote: string;
  workspaceId: string;
  token: string;
}

export async function getWorkspacesFromConfig(configFolder?: string): Promise<{ workspaces: Workspace[], active: string }> {
  // Check if running in web environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    // Web environment - return empty config
    console.log('Running in web environment, skipping file system operations');
    return { workspaces: [], active: "" };
  }
  
  try {
    const fs = await import('fs');
    const folder = configFolder && configFolder.length > 0 ? configFolder : undefined;
    const workspacePath = await getWorkspaceConfigFilePath(folder);
    const activeWorkspacePath = await getActiveWorkspaceConfigFilePath(folder);
    const workspacesConfig = fs.readFileSync(workspacePath, "utf8");
    const activeWorkspaceConfig = fs.readFileSync(activeWorkspacePath, "utf8");
    const workspaces = workspacesConfig.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
    return { workspaces, active: activeWorkspaceConfig };
  } catch (error) {
    console.error('error getting workspaces from cli config', error);
    return { workspaces: [], active: "" };
  }
}

export function setGlobalStatusBarItem(item: vscode.StatusBarItem) {
  globalStatusBarItem = item;
}

export function setWorkspaceStatus(myStatusBarItem?: vscode.StatusBarItem) {
  const statusBarItem = myStatusBarItem || globalStatusBarItem;
  if (statusBarItem) {
    const currentWorkspace =
      vscode.workspace
        .getConfiguration("windmill")
        ?.get("currentWorkspace") ?? "main";

    statusBarItem.text = `WM: ${currentWorkspace}`;
    statusBarItem.show();
  }
}

export function getCurrentWorkspaceConfig(): {
  token: string;
  workspace: string;
  remoteUrl: string;
  currentWorkspace: string;
} {
  const conf = vscode.workspace.getConfiguration("windmill");
  const currentWorkspace = conf.get("currentWorkspace") ?? "main";
  let token: string;
  let workspace: string;
  let remoteUrl: string;

  if (
    currentWorkspace === "main" ||
    currentWorkspace === "" ||
    !currentWorkspace
  ) {
    token = conf.get("token") as string;
    workspace = conf.get("workspaceId") as string;
    remoteUrl = conf.get("remote") as string;
  } else {
    const remotes = conf.get("additionalWorkspaces") as any[];
    const remote = remotes.find((r) => r.name === currentWorkspace);
    if (!remote) {
      throw new Error(`Invalid remote: ${currentWorkspace} not found among the additionalRemotes`);
    }
    token = remote.token;
    workspace = remote.workspaceId;
    remoteUrl = remote.remote;
  }

  if (!remoteUrl.endsWith("/")) {
    remoteUrl += "/";
  }

  return {
    token,
    workspace,
    remoteUrl,
    currentWorkspace: currentWorkspace as string,
  };
}

/**
 * Get all configured workspaces from VSCode settings
 * @returns Array of workspaces including main and additional workspaces
 */
export function getWorkspacesFromVSCodeConfig(): Workspace[] {
  const conf = vscode.workspace.getConfiguration("windmill");
  const workspaces: Workspace[] = [];

  // Add additional workspaces first (these have correct CLI profile names)
  const additionalWorkspaces = (conf.get("additionalWorkspaces") as any[]) || [];
  workspaces.push(...additionalWorkspaces.map((w: any) => ({
    name: w.name,
    remote: w.remote,
    workspaceId: w.workspaceId,
    token: w.token,
  })));

  // Add main workspace only if no additional workspace has the same remote+workspaceId.
  // When CLI config is synced, the top-level settings are a copy of the active CLI workspace
  // which is already in additionalWorkspaces with its correct profile name. Adding a
  // synthetic "main" entry would cause switchWorkspaceForBranch to pick "main" instead of
  // the actual CLI profile name.
  const mainRemote = conf.get("remote") as string;
  const mainWorkspaceId = conf.get("workspaceId") as string;
  const mainToken = conf.get("token") as string;

  if (mainRemote && mainWorkspaceId && mainToken) {
    const normalizedMainRemote = mainRemote.endsWith('/') ? mainRemote : mainRemote + '/';
    const isDuplicate = workspaces.some(w => {
      const normalizedRemote = w.remote.endsWith('/') ? w.remote : w.remote + '/';
      return normalizedRemote === normalizedMainRemote && w.workspaceId === mainWorkspaceId;
    });

    if (!isDuplicate) {
      workspaces.push({
        name: "main",
        remote: mainRemote,
        workspaceId: mainWorkspaceId,
        token: mainToken,
      });
    }
  }

  return workspaces;
}

/**
 * Sync VSCode configuration from CLI workspace config
 * @param channel Output channel for logging
 * @returns Object with workspaces array and synced status
 */
export async function syncVSCodeConfigFromCLI(
  channel: vscode.OutputChannel
): Promise<{ workspaces: Workspace[]; synced: boolean }> {
  try {
    const conf = vscode.workspace.getConfiguration("windmill");
    const folderOverride = conf.get("configFolder") as string;
    const { workspaces, active } = await getWorkspacesFromConfig(folderOverride);
    
    if (workspaces.length === 0) {
      channel.appendLine("No workspaces found in CLI config");
      return { workspaces: [], synced: false };
    }

    const activeWorkspace = workspaces.find((w: any) => w.name === active);
    if (!activeWorkspace) {
      channel.appendLine(`Active workspace "${active}" not found in CLI config`);
      return { workspaces, synced: false };
    }

    const { remote, workspaceId, token } = activeWorkspace;
    
    // Sync to VSCode settings
    await conf.update("remote", remote, vscode.ConfigurationTarget.Global);
    await conf.update("workspaceId", workspaceId, vscode.ConfigurationTarget.Global);
    await conf.update("token", token, vscode.ConfigurationTarget.Global);
    await conf.update("currentWorkspace", active, vscode.ConfigurationTarget.Global);
    await conf.update(
      "additionalWorkspaces",
      workspaces.map((w) => ({
        name: w.name,
        remote: w.remote,
        workspaceId: w.workspaceId,
        token: w.token,
      })),
      vscode.ConfigurationTarget.Global
    );
    
    channel.appendLine(`Synced ${workspaces.length} workspace(s) from CLI config`);
    channel.appendLine(`Active workspace: ${active}`);
    
    return { workspaces, synced: true };
  } catch (error) {
    channel.appendLine(`Error syncing VSCode config from CLI: ${error}`);
    console.error("Error syncing config:", error);
    return { workspaces: [], synced: false };
  }
}

/**
 * Check the current git branch and switch workspace if configured
 * @param channel Output channel for logging
 * @param cachedWorkspacesConfig Optional cached workspaces config to avoid reloading
 * @returns Object with switched status and loaded config for caching
 */
export async function checkAndSwitchWorkspaceForGitBranch(
  channel: vscode.OutputChannel,
  cachedWorkspacesConfig: WorkspacesConfig | undefined
): Promise<{ switched: boolean; config?: WorkspacesConfig }> {
  try {
    // Get current git branch
    const currentBranch = await getCurrentGitBranch();
    if (!currentBranch) {
      channel.appendLine("No git branch detected or not in a git repository");
      return { switched: false };
    }

    channel.appendLine(`Current git branch: ${currentBranch}`);

    let workspaces = cachedWorkspacesConfig;

    // If we don't have the config cached yet, load it
    if (!workspaces) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        channel.appendLine("No workspace folder found");
        return { switched: false };
      }

      const rootPath = workspaceFolders[0].uri.toString();
      // Call loadConfigForPath with empty string to check root wmill.yaml
      const config = await loadConfigForPath("", rootPath, channel);
      workspaces = config.workspaces;
    }

    if (!workspaces) {
      channel.appendLine("No workspaces configuration found in wmill.yaml");
      return { switched: false, config: undefined };
    }

    // Switch workspace based on branch (checks against VSCode config internally)
    const switched = await switchWorkspaceForBranch(currentBranch, workspaces, channel);
    return { switched, config: workspaces };
  } catch (error) {
    channel.appendLine(`Error checking git branch for workspace switch: ${error}`);
    console.error("Error checking git branch:", error);
    return { switched: false };
  }
}

/**
 * Normalize a remote URL the same way the CLI does when storing workspace
 * profiles, so that config-file and settings-entered URLs compare equal.
 */
function normalizeRemote(remote: string): string {
  try {
    return new URL(remote).toString();
  } catch {
    return remote.endsWith("/") ? remote : remote + "/";
  }
}

/**
 * Register (or refresh) the derived workspace entry for a fork workspace: the
 * parent's remote and auth, with the fork's workspace id. `syncVSCodeConfigFromCLI`
 * rewrites `additionalWorkspaces` wholesale from the CLI profiles, so this runs
 * after every sync to re-add the entry.
 * @returns the name of the fork workspace entry
 */
async function ensureForkWorkspaceProfile(
  parent: Workspace,
  forkWorkspaceId: string,
  branchName: string,
  channel?: vscode.OutputChannel
): Promise<string> {
  const forkName = `${parent.name}/${forkWorkspaceId}`;
  const entry = {
    name: forkName,
    remote: parent.remote,
    workspaceId: forkWorkspaceId,
    token: parent.token,
  };

  const conf = vscode.workspace.getConfiguration("windmill");
  const additionalWorkspaces = ((conf.get("additionalWorkspaces") as any[]) ?? []).slice();
  const existingIndex = additionalWorkspaces.findIndex((w) => w?.name === forkName);
  const existing = existingIndex >= 0 ? additionalWorkspaces[existingIndex] : undefined;

  const upToDate =
    existing &&
    existing.remote === entry.remote &&
    existing.workspaceId === entry.workspaceId &&
    existing.token === entry.token;

  if (!upToDate) {
    if (existingIndex >= 0) {
      additionalWorkspaces[existingIndex] = entry;
    } else {
      additionalWorkspaces.push(entry);
    }
    await conf.update(
      "additionalWorkspaces",
      additionalWorkspaces,
      vscode.ConfigurationTarget.Global
    );
    channel?.appendLine(
      `Targeting fork workspace "${forkWorkspaceId}" (fork of "${parent.workspaceId}" on ${parent.remote}, ` +
      `auth reused from workspace "${parent.name}"), resolved from git branch "${branchName}"`
    );
  }

  return forkName;
}

/**
 * Switch workspace based on git branch configuration
 * @param branchName The current git branch name
 * @param workspacesConfig The workspaces configuration from wmill.yaml
 * @param channel Optional output channel for logging
 * @returns true if workspace was switched, false otherwise
 */
export async function switchWorkspaceForBranch(
  branchName: string,
  workspacesConfig: WorkspacesConfig | undefined,
  channel?: vscode.OutputChannel
): Promise<boolean> {
  if (!workspacesConfig || !branchName) {
    channel?.appendLine(`No workspaces config or branch name provided. Skipping workspace switch.`);
    return false;
  }

  // On a `wm-fork/<base>/<id>` branch the target is the fork workspace, whose id
  // comes from the branch name itself. wmill.yaml is only consulted for the base
  // branch's entry, which supplies the remote (and, through its profile, the auth)
  // the fork is reached with.
  const forkBaseBranch = getOriginalBranchForWorkspaceForks(branchName);
  const forkWorkspaceId = getWorkspaceIdForWorkspaceForkFromBranchName(branchName);
  const lookupBranch = forkBaseBranch ?? branchName;

  const match = findWorkspaceByGitBranch(workspacesConfig, lookupBranch);
  if (!match) {
    const via = forkBaseBranch
      ? `${branchName} (base branch ${forkBaseBranch})`
      : branchName;
    channel?.appendLine(`No workspace configuration found for branch: ${via}. Keeping current workspace.`);
    return false;
  }
  const [wsName, branchWorkspace] = match;

  try {
    const { baseUrl } = branchWorkspace;
    const workspaceId = getEffectiveWorkspaceId(wsName, branchWorkspace);

    if (!baseUrl) {
      channel?.appendLine(
        `Workspace "${wsName}" (branch ${branchName}) has no baseUrl in wmill.yaml. Cannot resolve a workspace to switch to.`
      );
      return false;
    }

    const normalizedBaseUrl = normalizeRemote(baseUrl);

    // Get all workspaces from VSCode config (includes both CLI-synced and manually configured)
    const vscodeWorkspaces = getWorkspacesFromVSCodeConfig();

    // Check if this workspace exists in VSCode config
    const matchingWorkspace = vscodeWorkspaces.find(
      (w: Workspace) =>
        normalizeRemote(w.remote) === normalizedBaseUrl && w.workspaceId === workspaceId
    );

    if (!matchingWorkspace) {
      channel?.appendLine(
        `Workspace "${workspaceId}" at "${normalizedBaseUrl}" not found in VSCode configuration. ` +
        `Please configure this workspace in VSCode settings before switching to branch "${branchName}".`
      );
      return false;
    }

    // The CLI never saves a profile for a fork workspace — it derives one from the
    // parent's at command time. Do the same here, since switching requires a named
    // workspace to exist in the VSCode configuration.
    const targetName = forkWorkspaceId
      ? await ensureForkWorkspaceProfile(matchingWorkspace, forkWorkspaceId, branchName, channel)
      : matchingWorkspace.name;

    const conf = vscode.workspace.getConfiguration("windmill");

    // Switch to the workspace using the name from config, if current workspace is not the same
    if (conf.get("currentWorkspace") === targetName) {
      channel?.appendLine(`Already on workspace "${targetName}"`);
      return true;
    }

    await conf.update("currentWorkspace", targetName, vscode.ConfigurationTarget.Global);
    channel?.appendLine(`Switched to workspace "${targetName}" for branch: ${branchName}`);
    vscode.window.showInformationMessage(
      `Switched to workspace "${targetName}"`
    );
    setWorkspaceStatus();
    return true;
  } catch (error) {
    channel?.appendLine(`Error switching workspace for branch ${branchName}: ${error}`);
    vscode.window.showErrorMessage(
      `Failed to switch Windmill workspace for git branch "${branchName}": ${error}`
    );
    return false;
  }
}