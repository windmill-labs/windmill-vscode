import * as vscode from "vscode";
import { getRootPathFromRunnablePath, determineLanguage } from "../helpers";

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

const MODULE_SUFFIX = "__module";

export function isScriptModulePath(p: string): boolean {
  return p.includes(MODULE_SUFFIX + "/");
}

export function getParentScriptBasePath(modulePath: string): string | undefined {
  const idx = modulePath.indexOf(MODULE_SUFFIX + "/");
  if (idx === -1) {
    return undefined;
  }
  return modulePath.substring(0, idx);
}

export function joinUriPath(rootUri: string, relativePath: string): string {
  const base = rootUri.endsWith("/") ? rootUri.slice(0, -1) : rootUri;
  const rel = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  return base + "/" + rel;
}

export const scriptExts = [".py", ".ts", ".go", ".sh", ".sql", ".gql", ".ps1", ".php", ".rs", ".cs", ".nu", ".java",
  ".fetch.ts", ".bun.ts", ".deno.ts", ".pg.sql", ".my.sql", ".bq.sql", ".sf.sql", ".ms.sql"];

/**
 * Sanitizes a string for safe use as a single path segment (file/directory name).
 * Removes path separators, control characters, and OS-reserved filename characters.
 */
export function sanitizePathSegment(name: string): string {
  // Remove control characters (0x00-0x1F), path separators, and OS-reserved chars
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f\\/:<>"|?*]/g, "");
}

/**
 * Resolves an !inline lock reference to its actual file content.
 * If the value is not an !inline reference, returns it as-is.
 */
export async function resolveInlineLock(
  lock: string | undefined,
  rootUri: string,
  channel: vscode.OutputChannel
): Promise<string | undefined> {
  if (
    !lock ||
    typeof lock !== "string" ||
    !lock.trimStart().startsWith("!inline ")
  ) {
    return lock;
  }
  const lockRelPath = lock.trimStart().split(" ")[1];
  const lockUri = vscode.Uri.parse(joinUriPath(rootUri, lockRelPath));
  try {
    channel.appendLine("reading lock file: " + lockRelPath);
    return await readTextFromUri(lockUri);
  } catch (e) {
    channel.appendLine(`Lock file ${lockRelPath} not found: ${e}`);
    return undefined;
  }
}

export async function findScriptContentFile(
  basePathUri: string
): Promise<string | undefined> {
  for (const ext of scriptExts) {
    const uri = vscode.Uri.parse(basePathUri + ext);
    if (await fileExists(uri)) {
      return basePathUri + ext;
    }
  }
  return undefined;
}

export type ScriptModule = {
  content: string;
  language: string;
  lock?: string;
};

export async function readModulesFromDisk(
  moduleFolderUri: string,
  defaultTs: "bun" | "deno" | undefined
): Promise<Record<string, ScriptModule> | undefined> {
  const folderUri = vscode.Uri.parse(moduleFolderUri);
  if (!(await fileExists(folderUri))) {
    return undefined;
  }

  const modules: Record<string, ScriptModule> = {};

  async function readDir(dirUri: vscode.Uri, relPrefix: string) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);
      const relPath = relPrefix ? relPrefix + "/" + name : name;

      if (type === vscode.FileType.Directory) {
        await readDir(childUri, relPath);
      } else if (type === vscode.FileType.File && !name.endsWith(".script.lock")) {
        const lang = determineLanguage(name, defaultTs);
        if (lang) {
          // Prefer content from open editors (may have unsaved changes)
          const openDoc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === childUri.toString()
          );
          const content = openDoc
            ? openDoc.getText()
            : await readTextFromUri(childUri);
          modules[relPath] = {
            content,
            language: lang,
          };
        }
      }
    }
  }

  await readDir(folderUri, "");

  if (Object.keys(modules).length === 0) {
    return undefined;
  }

  return modules;
}