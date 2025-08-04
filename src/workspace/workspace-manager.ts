import { execSync } from "child_process";
import * as vscode from "vscode";
import * as fs from "fs";

let globalStatusBarItem: vscode.StatusBarItem | undefined = undefined;

type Workspace = {
  name: string;
  remote: string;
  workspaceId: string;
  token: string;
}

export function getCLIConfigPath(): string {
  try {
    const result = execSync('wmill config -p');
    return result.toString().trim();
  } catch (error) {
    console.error('error getting cli config path', error);
    return "";
  }
}

export function getWorkspacesFromCLIConfig(cliConfigFolder?: string): { workspaces: Workspace[], active: string, configPath: string } {
  try {
    const path = cliConfigFolder && cliConfigFolder.length > 0 ? cliConfigFolder : getCLIConfigPath();
    // add final slash if not present
    const configPath = path.endsWith("/") ? path : path + "/";
    const config = fs.readFileSync(configPath + "remotes.ndjson", "utf8");
    const active = fs.readFileSync(configPath + "activeWorkspace", "utf8");
    const workspaces = config.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
    return { workspaces, active, configPath: path };
  } catch (error) {
    console.error('error getting workspaces from cli config', error);
    return { workspaces: [], active: "", configPath: "" };
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