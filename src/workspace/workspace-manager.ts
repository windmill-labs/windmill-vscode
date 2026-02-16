import * as vscode from "vscode";
import { getWorkspaceConfigFilePath, getActiveWorkspaceConfigFilePath } from "windmill-utils-internal";
import { GitBranchConfig, loadConfigForPath } from "../config/config-manager";
import { getCurrentGitBranch } from "../utils/git-utils";

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
 * @param cachedGitBranchConfig Optional cached gitBranches config to avoid reloading
 * @returns Object with switched status and loaded config for caching
 */
export async function checkAndSwitchWorkspaceForGitBranch(
  channel: vscode.OutputChannel,
  cachedGitBranchConfig: GitBranchConfig | undefined
): Promise<{ switched: boolean; config?: GitBranchConfig }> {
  try {
    // Get current git branch
    const currentBranch = await getCurrentGitBranch();
    if (!currentBranch) {
      channel.appendLine("No git branch detected or not in a git repository");
      return { switched: false };
    }

    channel.appendLine(`Current git branch: ${currentBranch}`);

    let gitBranches = cachedGitBranchConfig;

    // If we don't have the config cached yet, load it
    if (!gitBranches) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        channel.appendLine("No workspace folder found");
        return { switched: false };
      }

      const rootPath = workspaceFolders[0].uri.toString();
      // Call loadConfigForPath with empty string to check root wmill.yaml
      const config = await loadConfigForPath("", rootPath, channel);
      gitBranches = config.gitBranches;
    }

    if (!gitBranches) {
      channel.appendLine("No gitBranches configuration found in wmill.yaml");
      return { switched: false, config: undefined };
    }

    // Switch workspace based on branch (checks against VSCode config internally)
    const switched = await switchWorkspaceForBranch(currentBranch, gitBranches, channel);
    return { switched, config: gitBranches };
  } catch (error) {
    channel.appendLine(`Error checking git branch for workspace switch: ${error}`);
    console.error("Error checking git branch:", error);
    return { switched: false };
  }
}

/**
 * Switch workspace based on git branch configuration
 * @param branchName The current git branch name
 * @param gitBranchConfig The gitBranches configuration from wmill.yaml
 * @param channel Optional output channel for logging
 * @returns true if workspace was switched, false otherwise
 */
export async function switchWorkspaceForBranch(
  branchName: string,
  gitBranchConfig: GitBranchConfig | undefined,
  channel?: vscode.OutputChannel
): Promise<boolean> {
  if (!gitBranchConfig || !branchName) {
    channel?.appendLine(`No git branch config or branch name provided. Skipping workspace switch.`);
    return false;
  }

  const branchWorkspace = gitBranchConfig[branchName];
  if (!branchWorkspace) {
    channel?.appendLine(`No workspace configuration found for branch: ${branchName}. Keeping current workspace.`);
    return false;
  }

  try {
    const { baseUrl, workspaceId } = branchWorkspace;
    
    if (!baseUrl || !workspaceId) {
      channel?.appendLine(`Invalid workspace configuration for branch ${branchName}. Missing baseUrl or workspaceId.`);
      return false;
    }

    // Normalize the base URL to ensure it ends with /
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

    // Get all workspaces from VSCode config (includes both CLI-synced and manually configured)
    const vscodeWorkspaces = getWorkspacesFromVSCodeConfig();
    
    // Check if this workspace exists in VSCode config
    const matchingWorkspace = vscodeWorkspaces.find(
      (w: Workspace) => w.remote === normalizedBaseUrl && w.workspaceId === workspaceId
    );

    if (!matchingWorkspace) {
      channel?.appendLine(
        `Workspace "${workspaceId}" at "${normalizedBaseUrl}" not found in VSCode configuration. ` +
        `Please configure this workspace in VSCode settings before switching to branch "${branchName}".`
      );
      return false;
    }

    const conf = vscode.workspace.getConfiguration("windmill");
    
    // Switch to the workspace using the name from config, if current workspace is not the same
    if (conf.get("currentWorkspace") === matchingWorkspace.name) {
      channel?.appendLine(`Already on workspace "${matchingWorkspace.name}"`);
      return true;
    }

    await conf.update("currentWorkspace", matchingWorkspace.name, vscode.ConfigurationTarget.Global);
    channel?.appendLine(`Switched to workspace "${matchingWorkspace.name}" for branch: ${branchName}`);
    vscode.window.showInformationMessage(
      `Switched to workspace "${matchingWorkspace.name}"`
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