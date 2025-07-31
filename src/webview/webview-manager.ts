import * as vscode from "vscode";
import { getCurrentWorkspaceConfig } from "../workspace/workspace-manager";

export function getWebviewContent(): string {
  let token: string;
  let workspace: string;
  let remoteUrl: string;
  let currentWorkspace: string;

  try {
    const config = getCurrentWorkspaceConfig();
    token = config.token;
    workspace = config.workspace;
    remoteUrl = config.remoteUrl;
    currentWorkspace = config.currentWorkspace;
  } catch (error) {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Windmill</title>
      </head>

      <body>
        ${(error as Error).message}
      </body>
      </html>`;
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