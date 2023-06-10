// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "windmill" is now active!');

  // const workspaceRoot =
  //   vscode.workspace.workspaceFolders &&
  //   vscode.workspace.workspaceFolders.length > 0
  //     ? vscode.workspace.workspaceFolders[0].uri.fsPath
  //     : undefined;
  // if (!workspaceRoot) {
  //   return;
  // }

  let currentPanel: vscode.WebviewPanel | undefined = undefined;

  vscode.window.onDidChangeActiveTextEditor((editor) => refreshPanel(editor));
  vscode.workspace.onDidChangeTextDocument((event) =>
    refreshPanel(vscode.window.activeTextEditor)
  );

  function refreshPanel(editor: vscode.TextEditor | undefined) {
    if (!editor) {
      return;
    }
    const rootPath = vscode.workspace.getWorkspaceFolder(editor.document.uri)
      ?.uri.fsPath;
    const cpath = editor?.document.uri.fsPath.replace(rootPath + "/", "");
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
        : "bash";

    const message = {
      content: editor?.document.getText(),
      path: wmPath,
      language: lang,
    };

    currentPanel?.webview.postMessage(message);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.runPreview", () => {
      if (currentPanel === undefined) {
        start();
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

  function start() {
    const tokenConf = vscode.workspace
      .getConfiguration("windmill")
      .get("token") as string;
    if (tokenConf === "" || !tokenConf) {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "windmill"
      );
    }

    if (currentPanel) {
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
      const conf = vscode.workspace.getConfiguration("windmill");
      const token = conf.get("token") as string;
      const workspace = conf.get("workspaceId") as string;
      const remote = conf.get("remote") as string;

      currentPanel.webview.html = getWebviewContent(remote, token, workspace);
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
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("windmill.start", () => {
      start();
    })
  );
}

//   const shellExec = new vscode.ShellExecution("wmill dev");
//   shellExec
//   context.subscriptions.push(shellExec)
//   let customTaskProvider = vscode.tasks.registerTaskProvider("wmilldev", {
//     provideTasks: async (token) => {
//       const task = new vscode.Task(
//         { type: "wmilldev" },
//         vscode.TaskScope.Workspace,
//         "Windmill Local Dev",
//         "wmilldev",
//         new vscode.ShellExecution("wmill dev"),
//         []
//       );
//       return [task];
//     },

//     resolveTask: async (task: vscode.Task) => undefined,
//   });

//   context.subscriptions.push(customTaskProvider);
// }

// This method is called when your extension is deactivated
export function deactivate() {}

function getWebviewContent(remote: string, token: string, workspace: string) {
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
        document.getElementById('iframe')?.contentWindow?.postMessage(message, '*');
    });
  </script>
	  <iframe id="iframe" src="${remote}scripts/dev?wm_token=${token}&workspace=${workspace}" width="100%" style="border: none; height: 100vh; background-color: white"></iframe>
  </body>
  </html>`;
}
