import * as vscode from "vscode";
import { FlowModule } from "windmill-client";
import { readTextFromUri } from "./file-utils";

export async function replaceInlineScripts(
  modules: FlowModule[],
  uriPath: string
): Promise<void> {
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
        await replaceInlineScripts(m.value.modules, uriPath);
      } else if (m.value.type === "branchall") {
        await Promise.all(
          m.value.branches.map(
            async (b) => await replaceInlineScripts(b.modules, uriPath)
          )
        );
      } else if (m.value.type === "branchone") {
        await Promise.all(
          m.value.branches.map(
            async (b) => await replaceInlineScripts(b.modules, uriPath)
          )
        );
        await replaceInlineScripts(m.value.default, uriPath);
      }
    })
  );
}