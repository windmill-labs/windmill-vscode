import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { extractCurrentMapping, extractInlineScripts } from "./flow";
import { determineLanguage } from "./helpers";
import { FlowModule, OpenFlow } from "windmill-client";
import { minimatch } from "minimatch";
import { testBundle } from "./esbuild";
import * as path from "path";
import { fileExists, readTextFromUri, getRootPath, isArrayEqual } from "./utils/file-utils";

export type Codebase = {
  assets?: {
    from: string;
    to: string;
  }[];
  external?: [];
  define?: { [key: string]: string };
  inject?: string[];
};

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

  const exts = ["yaml", "ts", "py", "go", "sql", "gql", "ps1", "sh", "php"];
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
  let lastDefaultTs: "deno" | "bun" = "bun";
  let codebaseFound: Codebase | undefined = undefined;
  let pinnedFileUri: vscode.Uri | undefined = undefined;

  function findCodebase(
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


  async function refreshPanel(
    editor: vscode.TextEditor | undefined,
    rsn: string
  ) {
    let targetEditor = editor;

    if (pinnedFileUri) {
      // Try to find the document corresponding to pinnedFileUri
      let doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === pinnedFileUri?.toString()
      );

      if (!doc) {
        // The document may not be open, open it
        try {
          doc = await vscode.workspace.openTextDocument(pinnedFileUri);
        } catch (e) {
          vscode.window.showErrorMessage(
            `Cannot open pinned file: ${pinnedFileUri?.fsPath}`
          );
          pinnedFileUri = undefined;
        }
      }

      if (doc) {
        targetEditor = {
          document: doc,
        } as vscode.TextEditor;
      } else {
        return;
      }
    }

    if (!targetEditor) {
      return;
    }

    const rootPath = getRootPath(targetEditor);

    const targetPath = targetEditor?.document.uri.path;

    if (
      !targetPath.includes(rootPath || "") ||
      targetPath.endsWith(path.sep + "wmill.yaml")
    ) {
      return;
    }
    // channel.appendLine("refreshing panel: " + rsn);

    lastActiveEditor = targetEditor;

    const cpath = targetEditor?.document.uri.path.replace(rootPath + "/", "");
    const splitted = cpath.split(".");
    const wmPath = splitted[0];

    if (rsn === "changeActiveTextEditor" || rsn === "start") {
      let splittedSlash = wmPath.split("/");
      channel.appendLine("wmPath: " + wmPath + "|" + splittedSlash);
      let found = false;
      for (let i = 0; i < splittedSlash.length; i++) {
        const path = splittedSlash.slice(0, i).join("/") + "/wmill.yaml";
        channel.appendLine(
          "checking if " + path + " exists: " + i + " " + splittedSlash.length
        );
        let uriPath = vscode.Uri.parse(rootPath + "/" + path);
        if (await fileExists(uriPath)) {
          let content = await readTextFromUri(uriPath);
          let config = (yaml.load(content) ?? {}) as any;
          lastDefaultTs = config?.["defaultTs"] ?? "bun";
          codebaseFound = cpath.endsWith(".ts")
            ? findCodebase(wmPath, config?.["codebases"] ?? [])
            : undefined;
          channel.appendLine(
            path +
              " exists! defaultTs: " +
              lastDefaultTs +
              ", isCodebase:" +
              JSON.stringify(codebaseFound)
          );
          found = true;
          break;
        }
      }
      if (!found) {
        codebaseFound = undefined;
      }
    }

    const lang = determineLanguage(cpath, lastDefaultTs);

    if (lang) {
      try {
        if (lang === "flow") {
          let uriPath = targetEditor?.document.uri.toString();
          let flow = yaml.load(targetEditor?.document.getText()) as OpenFlow;
          async function replaceInlineScripts(modules: FlowModule[]) {
            await Promise.all(
              modules.map(async (m) => {
                if (m.value.type === "rawscript") {
                  const path = m.value.content.split(" ")[1];
                  const fpath =
                    uriPath.split("/").slice(0, -1).join("/") + "/" + path;
                  let text = "";
                  try {
                    text = await readTextFromUri(vscode.Uri.parse(fpath));
                  } catch (e) {}
                  m.value.content = text;
                  if (m.value.lock && m.value.lock?.startsWith("!inline ")) {
                    const lockPath = m.value.lock.split(" ")[1];
                    const fpath =
                      uriPath.split("/").slice(0, -1).join("/") +
                      "/" +
                      lockPath;
                    let text = "";
                    try {
                      text = await readTextFromUri(vscode.Uri.parse(fpath));
                    } catch (e) {}
                    m.value.lock = text;
                  }
                } else if (
                  m.value.type === "forloopflow" ||
                  m.value.type === "whileloopflow"
                ) {
                  await replaceInlineScripts(m.value.modules);
                } else if (m.value.type === "branchall") {
                  await Promise.all(
                    m.value.branches.map(
                      async (b) => await replaceInlineScripts(b.modules)
                    )
                  );
                } else if (m.value.type === "branchone") {
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

          lastFlowDocument = targetEditor?.document;
          currentPanel?.webview.postMessage(message);
        } else {
          let lock: string | undefined = undefined;
          let tag: string | undefined = undefined;
          const uri = vscode.Uri.parse(
            targetEditor.document.uri.toString().split(".")[0] + ".script.yaml"
          );
          if (await fileExists(uri)) {
            const rd = await readTextFromUri(uri);
            const config = (yaml.load(rd) as any) ?? {};
            let nlock = config?.["lock"];
            if (
              nlock &&
              typeof nlock === "string" &&
              nlock.trimStart().startsWith("!inline ")
            ) {
              const path = nlock.split(" ")[1];
              const rootPath = getRootPath(targetEditor);
              const uriPath = rootPath + "/" + path;
              try {
                channel.appendLine("reading lock file: " + uriPath);
                nlock = await readTextFromUri(vscode.Uri.parse(uriPath));
              } catch (e) {
                channel.appendLine(`Lock file ${path} not found: ${e}`);
              }
            }
            lock = nlock;
            tag = config?.["tag"];
          }
          const message = {
            type: "replaceScript",
            content: targetEditor?.document.getText(),
            path: wmPath,
            language: lang,
            lock,
            tag,
            codebaseFound: codebaseFound,
            isCodebase: codebaseFound !== undefined,
          };

          channel.appendLine(
            "sending message: " +
              JSON.stringify({
                lang,
                isFileCodebase: codebaseFound,
                wmPath,
                rsn,
              })
          );

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
                        await conf.update("currentWorkspace", name, false);
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
          if (pinnedFileUri) {
            pinnedFileUri = undefined;
          }
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
          case "testBundle":
            const cpath1 = lastActiveEditor?.document.uri.path;
            testBundle(
              cpath1,
              lastActiveEditor?.document.getText() ?? "",
              message.id,
              channel.appendLine,
              codebaseFound,
              lastActiveEditor ? getRootPath(lastActiveEditor) : undefined,
              "cjs",
              "node",
              message.type,
              (x) => {
                currentPanel?.webview.postMessage(x);
              }
            );
            return;
          case "testPreviewBundle":
            const cpath2 = lastActiveEditor?.document.uri.path;
            testBundle(
              cpath2,
              lastActiveEditor?.document.getText() ?? "",
              message.id,
              channel.appendLine,
              undefined,
              lastActiveEditor ? getRootPath(lastActiveEditor) : undefined,
              "esm",
              "browser",
              message.type,
              (x) => {
                currentPanel?.webview.postMessage(x);
              }
            );
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
            extractCurrentMapping(currentLoadedFlow, inlineScriptMapping);

            channel.appendLine(
              "mapping: " + JSON.stringify(inlineScriptMapping)
            );
            const allExtracted = extractInlineScripts(
              message?.flow?.value?.modules ?? [],
              lastDefaultTs ?? "bun",
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

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.pinPreview", () => {
      if (vscode.window.activeTextEditor) {
        pinnedFileUri = vscode.window.activeTextEditor.document.uri;
        if (currentPanel === undefined) {
          start();
        } else {
          refreshPanel(vscode.window.activeTextEditor, "pinPreview");
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.unpinPreview", () => {
      pinnedFileUri = undefined;
      if (currentPanel === undefined) {
        // Do nothing
      } else {
        refreshPanel(vscode.window.activeTextEditor, "unpinPreview");
      }
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
        Invalid remote: ${currentWorkspace} not found among the additionalRemotes
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

  vscode.window.showInformationMessage(
    `Starting Windmill with workspace ${currentWorkspace} on ${remoteUrl}dev`
  );

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Windmill</title>
  </head>

  <body>
    <div id="loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 20px;">
      Loading ${currentWorkspace} on ${remoteUrl}dev...
    </div>
    <iframe id="iframe" src="${remoteUrl}dev?wm_token=${token}&workspace=${workspace}&activeColorTheme=${vscode.window.activeColorTheme.kind}" width="100%" style="border: none; height: 100vh;"></iframe>
    <script>
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('iframe');
    const h1 = document.getElementById('foo');
    const loading = document.getElementById('loading');

    iframe.onload = function() {
      setTimeout(() => {
        loading.style.display = 'none'; 
        iframe.style.display = 'block';  
      }, 1000);
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (event.origin.startsWith('vscode-webview://')) {
          iframe.contentWindow?.postMessage(message, '*');
        } else {
          if (message.type === 'keydown') {
            window.dispatchEvent(new KeyboardEvent('keydown', JSON.parse(message.key)));
          } else if (message.type === 'refresh') {
            vscode.postMessage({ type: 'refresh' });
          } else if (['flow', 'testBundle', 'testPreviewBundle'].includes(message.type)) {
            vscode.postMessage(message);
          } 
        }
    });
  </script>
  </body>
  </html>`;
}
