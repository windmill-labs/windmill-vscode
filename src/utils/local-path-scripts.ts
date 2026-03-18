import * as vscode from "vscode";
import * as yaml from "yaml";
import { LocalScriptInfo } from "windmill-utils-internal";
import { determineLanguage } from "../helpers";
import { fileExists, readTextFromUri, resolveInlineLock, scriptExts } from "./file-utils";

/**
 * Creates a script reader function that resolves local PathScript files
 * for use with replaceAllPathScriptsWithLocal.
 *
 * @param rootUri - The root URI string of the windmill project (e.g. "file:///path/to/project/")
 * @param defaultTs - Default TypeScript variant ("bun" or "deno")
 * @param channel - Output channel for logging
 */
export function createLocalScriptReader(
  rootUri: string,
  defaultTs: "bun" | "deno",
  channel: vscode.OutputChannel
): (scriptPath: string) => Promise<LocalScriptInfo | undefined> {
  return async (scriptPath: string): Promise<LocalScriptInfo | undefined> => {
    const baseUri = rootUri + scriptPath;

    for (const ext of scriptExts) {
      const fileUri = vscode.Uri.parse(baseUri + ext);
      if (!(await fileExists(fileUri))) {
        continue;
      }

      const filePath = scriptPath + ext;
      const language = determineLanguage(filePath, defaultTs);
      if (!language || language === "flow") {
        continue;
      }

      // Prefer content from open editors (may have unsaved changes)
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === fileUri.toString()
      );
      const content = openDoc
        ? openDoc.getText()
        : await readTextFromUri(fileUri);

      // Read metadata (.script.yaml) for lock and tag
      let lock: string | undefined;
      let tag: string | undefined;
      const metadataUri = vscode.Uri.parse(baseUri + ".script.yaml");
      if (await fileExists(metadataUri)) {
        try {
          const metadataText = await readTextFromUri(metadataUri);
          const metadata = (yaml.parse(metadataText) as any) ?? {};
          lock = await resolveInlineLock(metadata?.lock, rootUri, channel);
          tag = metadata?.tag;
        } catch (e) {
          channel.appendLine(`Failed to parse metadata for ${scriptPath}: ${e}`);
        }
      }

      channel.appendLine(`Resolved local PathScript: ${scriptPath} -> ${filePath} (${language})`);

      return {
        content,
        language: language as LocalScriptInfo["language"],
        lock,
        tag,
      };
    }

    return undefined;
  };
}
