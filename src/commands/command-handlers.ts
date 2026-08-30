import * as vscode from "vscode";
import { setWorkspaceStatus } from "../workspace/workspace-manager";
import { getWebviewContent } from "../webview/webview-manager";

function isValidUrl(urlString: string) {
  let url;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

export function registerCommands(
  context: vscode.ExtensionContext,
  switchRemoteId: string,
  currentPanel: () => vscode.WebviewPanel | undefined,
  refreshPanel: (editor: vscode.TextEditor | undefined, reason: string) => void,
  setPinnedFileUri: (uri: vscode.Uri | undefined) => void,
  start: () => Promise<void>
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.runPreview", async () => {
      if (currentPanel() === undefined) {
        await start();
      }
      currentPanel()?.webview.postMessage({ type: "runTest" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.setupConfiguration", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "windmill"
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.addWorkspace", async () => {
      let remote: string | undefined;
      while (true) {
        remote = await vscode.window.showInputBox({
          prompt: "Enter the remote URL",
          placeHolder: "https://api.windmill.dev",
          ignoreFocusOut: true,
        });
        if (remote === undefined) {
          // User pressed Esc, exit
          return;
        }
        if (isValidUrl(remote)) {
          break;
        }
        vscode.window.showErrorMessage("Please enter a valid remote URL.");
      }

      let workspaceId: string | undefined;
      while (true) {
        workspaceId = await vscode.window.showInputBox({
          prompt: "Enter workspace id",
          placeHolder: "demo",
          ignoreFocusOut: true,
        });
        if (workspaceId === undefined) {
          // User pressed Esc, exit
          return;
        }
        if (workspaceId.trim() !== "") {
          break;
        }
        vscode.window.showErrorMessage("Workspace ID is required.");
      }

      let token: string | undefined;
      while (true) {
        token = await vscode.window.showInputBox({
          prompt: "Enter user token",
          ignoreFocusOut: true,
        });
        if (token === undefined) {
          // User pressed Esc, exit
          return;
        }
        if (token.trim() !== "") {
          break;
        }
        vscode.window.showErrorMessage("User token is required.");
      }
      const conf = vscode.workspace.getConfiguration("windmill");
      if (conf.get("token") === "" || !conf.get("token")) {
        await conf.update("remote", remote, true);
        await conf.update("token", token, true);
        await conf.update("workspaceId", workspaceId, true);
        if (currentPanel()) {
          currentPanel()!.webview.html = getWebviewContent();
        }
        refreshPanel(vscode.window.activeTextEditor, "init");
      } else {
        let name: string | undefined;
        while (true) {
          name = await vscode.window.showInputBox({
            prompt: "Enter workspace name",
            ignoreFocusOut: true,
          });
          if (name === undefined) {
            // User pressed Esc, exit
            return;
          }
          if (name.trim() !== "") {
            break;
          }
          vscode.window.showErrorMessage("Workspace name is required.");
        }
        const remotes = conf.get("additionalWorkspaces") as string[];
        await conf.update(
          "additionalWorkspaces",
          [...(remotes || []), { name, token, workspaceId, remote }],
          true
        );
        await conf.update("currentWorkspace", name, false);
        if (currentPanel()) {
          currentPanel()!.webview.html = getWebviewContent();
        }
        refreshPanel(vscode.window.activeTextEditor, "init2");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(switchRemoteId, () => {
      const remotes = (
        (vscode.workspace
          .getConfiguration("windmill")
          .get("additionalWorkspaces") as any[]) ?? []
      ).map((r: any) => r?.name ?? "unknown");
      vscode.window
        .showQuickPick(["main", ...remotes, "Add a remote"], {
          canPickMany: false,
        })
        .then(async (value) => {
          if (value === "Add a remote") {
            vscode.commands.executeCommand("windmill.addWorkspace");
            return;
          } else {
            vscode.window.showInformationMessage(
              "Switching selected workspace to " + value
            );
            await vscode.workspace
              .getConfiguration("windmill")
              .update("currentWorkspace", value, true);
            await vscode.workspace
              .getConfiguration("windmill")
              .update("currentWorkspace", value);
            vscode.window.showInformationMessage(
              "Switched to " +
                vscode.workspace
                  .getConfiguration("windmill")
                  ?.get("currentWorkspace")
            );
            setWorkspaceStatus();

            if (currentPanel()) {
              currentPanel()!.webview.html = getWebviewContent();
            }
            refreshPanel(vscode.window.activeTextEditor, "init 3");
          }
        });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.start", () => {
      start();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.pinPreview", () => {
      if (vscode.window.activeTextEditor) {
        setPinnedFileUri(vscode.window.activeTextEditor.document.uri);
        if (currentPanel() === undefined) {
          start();
        } else {
          refreshPanel(vscode.window.activeTextEditor, "pinPreview");
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.unpinPreview", () => {
      setPinnedFileUri(undefined);
      if (currentPanel() === undefined) {
        // Do nothing
      } else {
        refreshPanel(vscode.window.activeTextEditor, "unpinPreview");
      }
    })
  );
}
