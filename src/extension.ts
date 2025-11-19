import * as vscode from "vscode";
import * as yaml from "yaml";
import { determineLanguage } from "./helpers";
import { FlowModule, OpenFlow } from "windmill-client";
import { testBundle } from "./esbuild";
import * as path from "path";
import {
  fileExists,
  readTextFromUri,
  getRootPath,
  isArrayEqual,
} from "./utils/file-utils";
import { loadConfigForPath, findCodebase } from "./config/config-manager";
import {
  setWorkspaceStatus,
  setGlobalStatusBarItem,
  getWorkspacesFromConfig,
  checkAndSwitchWorkspaceForGitBranch,
} from "./workspace/workspace-manager";
import { getWebviewContent } from "./webview/webview-manager";
import { registerCommands } from "./commands/command-handlers";
import { FlowDiagnosticProvider } from "./validation/diagnostic-provider";
import {
  replaceInlineScripts,
  extractInlineScripts,
  extractCurrentMapping,
} from "windmill-utils-internal";
import { getGitHeadPath } from "./utils/git-utils";
import { GitBranchConfig } from "./config/config-manager";

export type Codebase = {
  assets?: {
    from: string;
    to: string;
  }[];
  external?: [];
  define?: { [key: string]: string };
  inject?: string[];
  format?: "cjs" | "esm";
};

let flowDiagnosticProvider: FlowDiagnosticProvider | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Windmill extension is now active");

  // Initialize flow validation diagnostics
  try {
    flowDiagnosticProvider = new FlowDiagnosticProvider();
    flowDiagnosticProvider.activate(context);
  } catch (error) {
    console.error("Failed to initialize flow validation:", error);
  }

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
  setGlobalStatusBarItem(myStatusBarItem);
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
    vscode.window.onDidChangeActiveTextEditor(() =>
      setWorkspaceStatus(myStatusBarItem)
    )
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() =>
      setWorkspaceStatus(myStatusBarItem)
    )
  );

  let lastActiveEditor: vscode.TextEditor | undefined = undefined;
  let lastFlowDocument: vscode.TextDocument | undefined = undefined;
  let lastDefaultTs: "deno" | "bun" = "bun";
  let codebaseFound: Codebase | undefined = undefined;
  let pinnedFileUri: vscode.Uri | undefined = undefined;
  let lastGitBranchConfig: GitBranchConfig | undefined = undefined;
  let gitHeadWatcher: vscode.FileSystemWatcher | undefined = undefined;

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
      !rootPath ||
      !targetPath.includes(rootPath) ||
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
      const configResult = await loadConfigForPath(wmPath, rootPath, channel);
      lastDefaultTs = configResult.defaultTs;
      codebaseFound = cpath.endsWith(".ts")
        ? findCodebase(wmPath, configResult.codebases)
        : undefined;
      lastGitBranchConfig = configResult.gitBranches;
    }

    const lang = determineLanguage(cpath, lastDefaultTs);

    if (lang) {
      try {
        if (lang === "flow") {
          let uriPath = targetEditor?.document.uri.toString();
          let flow = yaml.parse(targetEditor?.document.getText()) as OpenFlow;

          await replaceInlineScripts(
            flow?.value?.modules,
            async (path) => {
              const fpath =
                uriPath.split("/").slice(0, -1).join("/") + "/" + path;
              return await readTextFromUri(vscode.Uri.parse(fpath));
            },
            {
              info: (...args: any[]) => channel.appendLine(args.join(" ")),
              error: (...args: any[]) => channel.appendLine(args.join(" ")),
            },
            uriPath
          );

          const message = {
            type: "replaceFlow",
            flow,
            uriPath,
            path: wmPath,
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
            const config = (yaml.parse(rd) as any) ?? {};
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

    setWorkspaceStatus(myStatusBarItem);
  }


  async function setupGitBranchWatcher() {
    try {
      // Clean up existing watcher if any
      if (gitHeadWatcher) {
        gitHeadWatcher.dispose();
        gitHeadWatcher = undefined;
      }

      const gitHeadPath = await getGitHeadPath();
      if (!gitHeadPath) {
        channel.appendLine("No .git/HEAD file found, skipping git branch watcher setup");
        return;
      }

      channel.appendLine(`Setting up git branch watcher on: ${gitHeadPath.fsPath}`);

      // Create file system watcher for .git/HEAD
      // We need to use a glob pattern relative to workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        channel.appendLine("No workspace folder found for watcher");
        return;
      }
      
      gitHeadWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolders[0], ".git/HEAD")
      );

      // Watch for changes to .git/HEAD (which happens on branch switch)
      gitHeadWatcher.onDidChange(async () => {
        channel.appendLine("Git HEAD changed, checking for workspace switch");
        const result = await checkAndSwitchWorkspaceForGitBranch(channel, lastGitBranchConfig);
        if (result.config) {
          lastGitBranchConfig = result.config;
        }
      });

      // Also watch for onCreate since git sometimes replaces the file
      gitHeadWatcher.onDidCreate(async () => {
        channel.appendLine("Git HEAD created, checking for workspace switch");
        const result = await checkAndSwitchWorkspaceForGitBranch(channel, lastGitBranchConfig);
        if (result.config) {
          lastGitBranchConfig = result.config;
        }
      });

      context.subscriptions.push(gitHeadWatcher);

      // Also check on initial setup
      const result = await checkAndSwitchWorkspaceForGitBranch(channel, lastGitBranchConfig);
      if (result.config) {
        lastGitBranchConfig = result.config;
      }
    } catch (error) {
      channel.appendLine(`Error setting up git branch watcher: ${error}`);
      console.error("Error setting up git branch watcher:", error);
    }
  }

  // Setup git branch watcher on activation
  setupGitBranchWatcher();

  async function start() {
    const tokenConf = vscode.workspace
      .getConfiguration("windmill")
      .get("token") as string;

    let gotFromConfig = false;
    try {
      // First check if we should use git branch-based workspace switching
      const gitBranchResult = await checkAndSwitchWorkspaceForGitBranch(channel, lastGitBranchConfig);
      if (gitBranchResult.config) {
        lastGitBranchConfig = gitBranchResult.config;
      }
      channel.appendLine(`Git branch workspace switch: ${gitBranchResult.switched}`);

      // Only use CLI config if git branch config is not applicable
      if (!gitBranchResult.switched) {
        const folderOverride = vscode.workspace
          .getConfiguration("windmill")
          .get("configFolder") as string;
        const { workspaces, active } = await getWorkspacesFromConfig(
          folderOverride
        );
        if (workspaces.length > 0) {
          const activeWorkspace = workspaces.find((w: any) => w.name === active);
          if (!activeWorkspace) {
            return;
          }
          const { remote, workspaceId, token } = activeWorkspace;
          await vscode.workspace
            .getConfiguration("windmill")
            .update("remote", remote, vscode.ConfigurationTarget.Global);
          await vscode.workspace
            .getConfiguration("windmill")
            .update(
              "workspaceId",
              workspaceId,
              vscode.ConfigurationTarget.Global
            );
          await vscode.workspace
            .getConfiguration("windmill")
            .update("token", token, vscode.ConfigurationTarget.Global);
          await vscode.workspace
            .getConfiguration("windmill")
            .update(
              "currentWorkspace",
              active,
              vscode.ConfigurationTarget.Global
            );
          await vscode.workspace.getConfiguration("windmill").update(
            "additionalWorkspaces",
            workspaces.map((w) => ({
              name: w.name,
              remote: w.remote,
              workspaceId: w.workspaceId,
              token: w.token,
            })),
            vscode.ConfigurationTarget.Global
          );
          vscode.window.showInformationMessage(
            "Workspace configuration updated from config"
          );
          gotFromConfig = true;
        }
      }
    } catch (e) {
      console.error("error getting workspaces from config", e);
    }

    if (!gotFromConfig && (!tokenConf || tokenConf === "")) {
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
              codebaseFound?.format ?? "cjs",
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
                  yaml.parse(lastFlowDocument?.getText() || "") as any
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

            const allExtracted = extractInlineScripts(
              message?.flow?.value?.modules ?? [],
              inlineScriptMapping,
              "/",
              lastDefaultTs ?? "bun"
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
              let text = yaml.stringify(message.flow);
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
              await lastFlowDocument?.save();
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

  // Register all commands
  registerCommands(
    context,
    switchRemoteId,
    () => currentPanel,
    refreshPanel,
    (uri) => {
      pinnedFileUri = uri;
    },
    start
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("deactivated extension windmill");
  flowDiagnosticProvider?.dispose();
}
