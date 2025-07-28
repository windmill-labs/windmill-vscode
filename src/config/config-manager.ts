import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { minimatch } from "minimatch";
import { fileExists, readTextFromUri } from "../utils/file-utils";
import { Codebase } from "../extension";

export function findCodebase(
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

export async function loadConfigForPath(
  wmPath: string,
  rootPath: string,
  channel: vscode.OutputChannel
): Promise<{
  defaultTs: "deno" | "bun";
  codebases: any[];
}> {
  let splittedSlash = wmPath.split("/");
  channel.appendLine("wmPath: " + wmPath + "|" + splittedSlash);
  let found = false;
  let defaultTs: "deno" | "bun" = "bun";
  let codebases: any[] = [];

  for (let i = 0; i < splittedSlash.length; i++) {
    const path = splittedSlash.slice(0, i).join("/") + "/wmill.yaml";
    channel.appendLine(
      "checking if " + path + " exists: " + i + " " + splittedSlash.length
    );
    let uriPath = vscode.Uri.parse(rootPath + "/" + path);
    if (await fileExists(uriPath)) {
      let content = await readTextFromUri(uriPath);
      let config = (yaml.load(content) ?? {}) as any;
      defaultTs = config?.["defaultTs"] ?? "bun";
      codebases = config?.["codebases"] ?? [];
      channel.appendLine(
        path +
          " exists! defaultTs: " +
          defaultTs +
          ", codebases:" +
          JSON.stringify(codebases)
      );
      found = true;
      break;
    }
  }
  
  if (!found) {
    codebases = [];
  }

  return { defaultTs, codebases };
}