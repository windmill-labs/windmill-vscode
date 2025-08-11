import * as vscode from "vscode";
import { getWorkspaceConfigFilePath, getActiveWorkspaceConfigFilePath } from "windmill-utils-internal";

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