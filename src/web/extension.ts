import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { extraCurrentMapping, extractInlineScripts } from "./flow";
import { getRootPathFromRunnablePath, determineLanguage } from "./helpers";
import { FlowModule, OpenFlow } from "windmill-client";

export function activate(context: vscode.ExtensionContext) {
  console.log("Windmill extension is now active");

  let currentPanel: vscode.WebviewPanel | undefined = undefined;
  let myStatusBarItem: vscode.StatusBarItem | undefined = undefined;
  let channel = vscode.window.createOutputChannel("windmill");
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
      refreshPanel(editor, "changeActiveTextEditor");
    })
  );

  const exts = ["yaml", "ts", "py", "go", "sql", "gql", "ps1", "sh"];
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (exts.some((ext) => event.document.uri.path.endsWith("." + ext))) {
        refreshPanel(vscode.window.activeTextEditor, "changeTextDocument");
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(setWorkspaceStatus)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(setWorkspaceStatus)
  );

  let lastActiveEditor: vscode.TextEditor | undefined = undefined;
  let lastFlowDocument: vscode.TextDocument | undefined = undefined;
  let lastDefaultTs: "deno" | "bun" = "deno";

  async function fileExists(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function readTextFromUri(uri: vscode.Uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  }

  async function refreshPanel(
    editor: vscode.TextEditor | undefined,
    rsn: string
  ) {
    if (!editor) {
      return;
    }

    const rootPath =
      getRootPathFromRunnablePath(editor.document.uri.path) ||
      vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.path;

    if (!editor?.document.uri.path.includes(rootPath || "")) {
      return;
    }
    // channel.appendLine("refreshing panel: " + rsn);

    lastActiveEditor = editor;

    const cpath = editor?.document.uri.path.replace(rootPath + "/", "");
    const splitted = cpath.split(".");
    const wmPath = splitted[0];

    if (rsn == "changeActiveTextEditor") {
      let splittedSlash = wmPath.split("/");
      channel.appendLine("wmPath: " + wmPath + "|" + splittedSlash);
      for (let i = 0; i < splittedSlash.length; i++) {
        const path = splittedSlash.slice(0, i).join("/") + "/wmill.yaml";
        channel.appendLine(
          "checking if " + path + " exists: " + i + " " + splittedSlash.length
        );
        let uriPath = vscode.Uri.parse(rootPath + "/" + path);
        if (await fileExists(uriPath)) {
          let content = await readTextFromUri(uriPath);
          let config = (yaml.load(content) ?? {}) as any;
          lastDefaultTs = config?.["defaultTs"] ?? "deno";
          channel.appendLine(path + " exists! defaultTs: " + lastDefaultTs);

          break;
        }
      }
    }

    const lang = determineLanguage(cpath, lastDefaultTs);

    if (lang) {
      try {
        if (lang == "flow") {
          let uriPath = editor?.document.uri.toString();
          let flow = yaml.load(editor?.document.getText()) as OpenFlow;
          async function replaceInlineScripts(modules: FlowModule[]) {
            await Promise.all(
              modules.map(async (m) => {
                if (m.value.type == "rawscript") {
                  const path = m.value.content.split(" ")[1];
                  const fpath =
                    uriPath.split("/").slice(0, -1).join("/") + "/" + path;
                  let text = "";
                  try {
                    text = await readTextFromUri(vscode.Uri.parse(fpath));
                  } catch (e) {}
                  m.value.content = text;
                } else if (m.value.type == "forloopflow") {
                  await replaceInlineScripts(m.value.modules);
                } else if (m.value.type == "branchall") {
                  await Promise.all(
                    m.value.branches.map(
                      async (b) => await replaceInlineScripts(b.modules)
                    )
                  );
                } else if (m.value.type == "branchone") {
                  await Promise.all(
                    m.value.branches.map(
                      async (b) => await replaceInlineScripts(b.modules)
                    )
                  );
                  await replaceInlineScripts(m.value.default);
                }
              })
            );
          }

          await replaceInlineScripts(flow?.value?.modules ?? []);

          const message = {
            type: "replaceFlow",
            flow,
            uriPath,
          };

          lastFlowDocument = editor?.document;
          currentPanel?.webview.postMessage(message);
        } else {
          let lock: string | undefined = undefined;
          const uri = vscode.Uri.parse(
            editor.document.uri.toString().split(".")[0] + ".script.yaml"
          );
          if (await fileExists(uri)) {
            const rd = await readTextFromUri(uri);
            const config = (yaml.load(rd) as any) ?? {};
            lock = config?.["lock"];
          }
          const message = {
            type: "replaceScript",
            content: editor?.document.getText(),
            path: wmPath,
            language: lang,
            lock,
          };

          currentPanel?.webview.postMessage(message);
        }
      } catch (e) {
        const message = {
          type: "error",
          error: e,
        };
        currentPanel?.webview.postMessage(message);
      }
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
                    refreshPanel(vscode.window.activeTextEditor, "init");
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
                        refreshPanel(vscode.window.activeTextEditor, "init2");
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
            refreshPanel(vscode.window.activeTextEditor, "init 3");
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
          retainContextWhenHidden: true,
          enableScripts: true,
        } // Webview options. More on these later.
      );

      currentPanel.title = "Windmill";
      currentPanel.webview.html = getWebviewContent();
      vscode.window.activeTextEditor &&
        refreshPanel(vscode.window.activeTextEditor, "start");
      currentPanel.onDidDispose(
        () => {
          currentPanel = undefined;
        },
        undefined,
        context.subscriptions
      );
    }
    currentPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "refresh":
            channel.appendLine("refreshing");
            if (lastActiveEditor) {
              refreshPanel(lastActiveEditor, "refresh message");
            }
            return;
          case "flow":
            let currentLoadedFlow: FlowModule[] | undefined = undefined;

            try {
              if (lastFlowDocument) {
                currentLoadedFlow = (
                  yaml.load(lastFlowDocument?.getText() || "") as any
                )?.["value"]?.["modules"] as FlowModule[];
                if (!Array.isArray(currentLoadedFlow)) {
                  currentLoadedFlow = undefined;
                }
              }
            } catch {}

            // channel.appendLine("flow message");
            let uri = vscode.Uri.parse(message.uriPath);
            if (!message.uriPath?.endsWith("flow.yaml")) {
              return;
            }
            let dirPath = uri.toString().split("/").slice(0, -1).join("/");
            let inlineScriptMapping = {};
            extraCurrentMapping(currentLoadedFlow, inlineScriptMapping);

            const allExtracted = extractInlineScripts(
              message?.flow?.value?.modules ?? [],
              undefined,
              inlineScriptMapping
            );
            await Promise.all(
              allExtracted.map(async (s) => {
                let encoded = new TextEncoder().encode(s.content);
                let inlineUri = vscode.Uri.parse(dirPath + "/" + s.path);
                let exists = await fileExists(inlineUri);

                if (
                  !exists ||
                  !isArrayEqual(
                    encoded,
                    await vscode.workspace.fs.readFile(inlineUri)
                  )
                ) {
                  vscode.workspace.fs.writeFile(
                    inlineUri,
                    new TextEncoder().encode(s.content)
                  );
                } else {
                  // channel.appendLine("same content");
                }
              })
            );

            if (!lastFlowDocument) {
              return;
            }
            let currentFlow = "";
            try {
              currentFlow = JSON.stringify(currentLoadedFlow);
            } catch {}
            if (JSON.stringify(message.flow) !== currentFlow) {
              let splitted = (lastFlowDocument?.getText() ?? "").split("\n");
              let edit = new vscode.WorkspaceEdit();
              let text = yaml.dump(message.flow);
              edit.replace(
                lastFlowDocument.uri,
                new vscode.Range(
                  new vscode.Position(0, 0),
                  new vscode.Position(
                    splitted.length,
                    splitted[splitted.length - 1].length
                  )
                ),
                text
              );
              await vscode.workspace.applyEdit(edit);
              const dir = await vscode.workspace.fs.readDirectory(
                vscode.Uri.parse(dirPath)
              );
              for (const f of dir.entries()) {
                let oldFile = f[1][0];

                if (
                  !oldFile.endsWith("flow.yaml") &&
                  allExtracted.find((s) => s.path === oldFile) === undefined
                ) {
                  await vscode.workspace.fs.delete(
                    vscode.Uri.parse(dirPath + "/" + oldFile)
                  );
                }
              }
            }

            return;
        }
      },
      undefined,
      context.subscriptions
    );
    refreshPanel(vscode.window.activeTextEditor, "start");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.start", () => {
      start();
    })
  );
}

function isArrayEqual(arr1: Uint8Array, arr2: Uint8Array): boolean {
  if (arr1.length !== arr2.length) {
    return false;
  }

  return arr1.every((value, index) => value === arr2[index]);
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

  if (!remoteUrl.endsWith("/")) {
    remoteUrl += "/";
  }

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Windmill</title>
  </head>

  <body>
    <iframe id="iframe" src="${remoteUrl}dev?wm_token=${token}&workspace=${workspace}&activeColorTheme=${vscode.window.activeColorTheme.kind}" width="100%" style="border: none; height: 100vh;"></iframe>
    <script>
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('iframe');
    const h1 = document.getElementById('foo');

    window.addEventListener('message', event => {
        const message = event.data;
        if (event.origin.startsWith('vscode-webview://')) {
          iframe.contentWindow?.postMessage(message, '*');
        } else {
          if (message.type === 'keydown') {
            window.dispatchEvent(new KeyboardEvent('keydown', JSON.parse(message.key)));
          } else if (message.type === 'refresh') {
            vscode.postMessage({ type: 'refresh' });
          } else if (message.type === 'flow') {
            vscode.postMessage(message);
          }
        }
    });
  </script>
  </body>
  </html>`;
}
