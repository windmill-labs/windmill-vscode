import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("Windmill extension is now active");

  let currentPanel: vscode.WebviewPanel | undefined = undefined;
  let myStatusBarItem: vscode.StatusBarItem | undefined = undefined;
  const switchRemoteId = "windmill.switchWorkspace";

  // create a new status bar item that we can now manage
  myStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  myStatusBarItem.command = switchRemoteId;
  context.subscriptions.push(myStatusBarItem);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshPanel(editor);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      refreshPanel(vscode.window.activeTextEditor);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(setWorkspaceStatus)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(setWorkspaceStatus)
  );

  function refreshPanel(editor: vscode.TextEditor | undefined) {
    if (!editor) {
      return;
    }
    const rootPath = vscode.workspace.getWorkspaceFolder(editor.document.uri)
      ?.uri.path;

    const cpath = editor?.document.uri.path.replace(rootPath + "/", "");
    const splitted = cpath.split(".");
    const wmPath = splitted[0];
    const ext = splitted[splitted.length - 1];
    const lang =
      ext === "py"
        ? "python3"
        : ext === "ts"
        ? "deno"
        : ext === "go"
        ? "go"
        : ext === "sh"
        ? "bash"
        : undefined;

    if (lang) {
      const message = {
        type: "replaceScript",
        content: editor?.document.getText(),
        path: wmPath,
        language: lang,
      };

      currentPanel?.webview.postMessage(message);
    }
    setWorkspaceStatus();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.runPreview", async () => {
      if (currentPanel === undefined) {
        await start();
      }
      currentPanel?.webview.postMessage({ type: "runTest" });
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
    vscode.commands.registerCommand("windmill.addWorkspace", () => {
      vscode.window
        .showInputBox({
          prompt: "Enter the remote URL",
          placeHolder: "https://app.windmill.dev/",
        })
        .then((remote) => {
          vscode.window
            .showInputBox({
              prompt: "Enter workspace id",
              placeHolder: "demo",
            })
            .then((workspaceId) => {
              vscode.window
                .showInputBox({
                  prompt: "Enter user token",
                })
                .then(async (token) => {
                  const conf = vscode.workspace.getConfiguration("windmill");
                  if (conf.get("token") === "" || !conf.get("token")) {
                    await conf.update("remote", remote, true);
                    await conf.update("token", token, true);
                    await conf.update("workspaceId", workspaceId, true);
                    if (currentPanel) {
                      currentPanel.webview.html = getWebviewContent();
                    }
                    refreshPanel(vscode.window.activeTextEditor);
                  } else {
                    vscode.window
                      .showInputBox({
                        prompt: "Enter workspace name",
                      })
                      .then(async (name) => {
                        const remotes = conf.get(
                          "additionalWorkspaces"
                        ) as string[];

                        await conf.update(
                          "additionalWorkspaces",
                          [
                            ...(remotes || []),
                            { name, token, workspaceId, remote },
                          ],
                          true
                        );
                        await conf.update("currentWorkspace", name);
                        if (currentPanel) {
                          currentPanel.webview.html = getWebviewContent();
                        }
                        refreshPanel(vscode.window.activeTextEditor);
                      });
                  }
                });
            });
        });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(switchRemoteId, () => {
      const remotes = (
        (vscode.workspace
          .getConfiguration("windmill")
          .get("additionalWorkspaces") as any[]) ?? []
      ).map((r: any) => r.name);
      vscode.window
        .showQuickPick(["main", ...remotes, "Add a remote"], {
          canPickMany: false,
        })
        .then(async (value) => {
          if (value === "Add a remote") {
            vscode.commands.executeCommand("windmill.addWorkspace");
            return;
          } else {
            await vscode.workspace
              .getConfiguration("windmill")
              .update("currentWorkspace", value, true);
            if (currentPanel) {
              currentPanel.webview.html = getWebviewContent();
            }
            refreshPanel(vscode.window.activeTextEditor);
          }
        });
    })
  );

  function setWorkspaceStatus() {
    if (myStatusBarItem) {
      const currentWorkspace =
        vscode.workspace
          .getConfiguration("windmill")
          ?.get("currentWorkspace") ?? "main";

      myStatusBarItem.text = `WM: ${currentWorkspace}`;
      myStatusBarItem.show();
    }
  }

  async function start() {
    const tokenConf = vscode.workspace
      .getConfiguration("windmill")
      .get("token") as string;
    if (tokenConf === "" || !tokenConf) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "windmill"
      );
      vscode.window.showInformationMessage(
        "Configure your token (fetch from your account settings) and workspace first (the workspace id, not the name)"
      );
      return;
    }

    if (currentPanel) {
      currentPanel.webview.html = getWebviewContent();
      currentPanel.reveal(vscode.ViewColumn.Two);
    } else {
      // Create and show a new webview
      currentPanel = vscode.window.createWebviewPanel(
        "windmill", // Identifies the type of the webview. Used internally
        "Windmill", // Title of the panel displayed to the user
        vscode.ViewColumn.Two, // Editor column to show the new webview panel in.
        {
          enableScripts: true,
        } // Webview options. More on these later.
      );

      currentPanel.title = "Windmill";
      currentPanel.webview.html = getWebviewContent();
      vscode.window.activeTextEditor &&
        refreshPanel(vscode.window.activeTextEditor);
      currentPanel.onDidDispose(
        () => {
          currentPanel = undefined;
        },
        undefined,
        context.subscriptions
      );
    }
    refreshPanel(vscode.window.activeTextEditor);
    // refresh every 5 seconds 3 times to make sure it's initialized
    setTimeout(() => {
      refreshPanel(vscode.window.activeTextEditor);
    }, 5000);
    setTimeout(() => {
      refreshPanel(vscode.window.activeTextEditor);
    }, 10000);
    setTimeout(() => {
      refreshPanel(vscode.window.activeTextEditor);
    }, 15000);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.start", () => {
      start();
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("deactivated extension windmill");
}

function getWebviewContent() {
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
      return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Windmill</title>
      </head>
    
      <body>
        Invalid remote: ${currentWorkspace} not found among the additionalRemotees
      </body>
      </html>`;
    }
    token = remote.token;
    workspace = remote.workspaceId;
    remoteUrl = remote.remote;
  }

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Windmill</title>
  </head>

  <body>
  <script>
    // Handle the message inside the webview
    window.addEventListener('message', event => {
        const message = event.data; 
        if (event.origin.startsWith('vscode-webview://')) {
          document.getElementById('iframe')?.contentWindow?.postMessage(message, '*');
        } else {
          window.dispatchEvent(new KeyboardEvent('keydown', JSON.parse(message)));
        }
    });
  </script>
      <iframe id="iframe" src="${remoteUrl}scripts/dev?wm_token=${token}&workspace=${workspace}&activeColorTheme=${vscode.window.activeColorTheme.kind}" width="100%" style="border: none; height: 100vh; background-color: white"></iframe>
  </body>
  </html>`;
}
