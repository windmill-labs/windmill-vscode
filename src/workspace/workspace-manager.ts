import * as vscode from "vscode";
import { getWorkspaceConfigFilePath, getActiveWorkspaceConfigFilePath } from "windmill-utils-internal";
import { GitBranchConfig } from "../config/config-manager";

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

    const conf = vscode.workspace.getConfiguration("windmill");
    
    // Normalize the base URL to ensure it ends with /
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

    // Check if this workspace exists in additionalWorkspaces
    const additionalWorkspaces = (conf.get("additionalWorkspaces") as any[]) || [];
    const existingWorkspace = additionalWorkspaces.find(
      (w: any) => w.remote === normalizedBaseUrl && w.workspaceId === workspaceId
    );

    if (!existingWorkspace) {
      // Add the new workspace
      const newWorkspace = {
        name: workspaceId,
        remote: normalizedBaseUrl,
        workspaceId: workspaceId,
        token: conf.get("token"),
      };

      const updatedWorkspaces = [...additionalWorkspaces, newWorkspace];
      await conf.update("additionalWorkspaces", updatedWorkspaces, vscode.ConfigurationTarget.Global);
      channel?.appendLine(`Created new additional workspace "${workspaceId}"`);
    }

    await conf.update("currentWorkspace", workspaceId, vscode.ConfigurationTarget.Global);
    channel?.appendLine(`Switched to workspace "${workspaceId}" for branch: ${branchName}`);
    vscode.window.showInformationMessage(
      `Switched to workspace "${workspaceId}"`
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