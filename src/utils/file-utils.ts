import * as vscode from "vscode";
import { getRootPathFromRunnablePath } from "../helpers";

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (e) {
    return false;
  }
}

export async function readTextFromUri(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

export function getRootPath(editor: vscode.TextEditor): string | undefined {
  return (
    getRootPathFromRunnablePath(editor.document.uri.path) ||
    vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.path
  );
}

export function isArrayEqual(arr1: Uint8Array, arr2: Uint8Array): boolean {
  if (arr1.length !== arr2.length) {
    return false;
  }

  return arr1.every((value, index) => value === arr2[index]);
}