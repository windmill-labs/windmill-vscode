import * as esbuild from "esbuild-wasm";
import { Codebase } from "./extension";
import * as vscode from "vscode";
import * as tar from "tar-stream";

let initialized = false;

export async function testBundle(
  path: string | undefined,
  contents: string,
  id: string,
  appendLine: (x: string) => void,
  codebase: Codebase | undefined,
  rootPath: string | undefined,
  format: "cjs" | "esm",
  platform: "node" | "browser",
  command: string,
  postMessage?: (x: any) => void
) {
  appendLine("testBundle message: " + path);
  if (!path) {
    postMessage?.({
      type: "testBundleError",
      id: id,
      error: "Path not found in current active editor",
    });
    return;
  }
  appendLine("testBundle start bundling: " + path);

  try {
    if (!initialized) {
      await esbuild.initialize({});
      initialized = true;
    }

    let splitted = path.split("/");
    let sourcefile = splitted[splitted.length - 1];
    let resolveDir = splitted.slice(0, splitted.length - 1).join("/");
    appendLine("starting building bundle: " + path);
    let out: string = (
      await esbuild.build({
        stdin: {
          contents,
          resolveDir,
          sourcefile,
          loader: "ts",
        },
        external: undefined,
        plugins:
          command === "testPreviewBundle"
            ? [
                {
                  name: "externalize-everything-relative",
                  setup(build) {
                    build.onResolve({ filter: /(.*)/ }, (args) => {
                      if (
                        args.kind === "import-statement" &&
                        !args.path.startsWith(".") &&
                        !args.path.startsWith("/")
                      ) {
                        return { path: args.path, external: true };
                      }
                    });
                  },
                },
              ]
            : [],
        format: format,
        bundle: true,
        write: false,
        platform: platform,
        packages: "bundle",
        target: platform === "node" ? "node20.15.1" : undefined,
      })
    ).outputFiles[0].text;

    let isTar = false;
    if (Array.isArray(codebase?.assets) && codebase.assets.length > 0) {
      appendLine(
        `Using the following asset configuration: ${JSON.stringify(
          codebase.assets
        )}`
      );
      const tarblob = await createTarFromStrings(out, codebase, rootPath);
      out = tarblob.toString("base64");

      // vscode.workspace.fs.writeFile(
      //   vscode.Uri.parse("file:///tmp/test3.tar"),
      //   Buffer.from(out, "base64")
      // );
      appendLine("tar created with size: " + tarblob.length + " " + out.length);
      isTar = true;
    }

    appendLine(command + " bundled: " + path);
    postMessage?.({
      type: command,
      id: id,
      file: out,
      isTar,
    });
    appendLine("sent");
  } catch (e) {
    appendLine("testBundle error: " + e);
    postMessage?.({
      type: "testBundleError",
      error: e,
    });
  }
}

async function createTarFromStrings(
  out: string,
  codebase: Codebase,
  rootPath: string | undefined
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    (async () => {
      const chunks: any[] = []; // Array to collect tar file chunks
      const tarball = tar.pack(); // Create a pack stream

      tarball.entry({ name: "main.js" }, out);
      for (const asset of codebase?.assets ?? []) {
        try {
          vscode.window.showInformationMessage(asset.from);
          const data = await vscode.workspace.fs.readFile(
            vscode.Uri.file((rootPath ? rootPath + "/" : "") + asset.from)
          );
          tarball.entry({ name: asset.to }, Buffer.from(data));
        } catch (e) {
          console.error(e);
          reject(e);
        }
      }
      // Finalize the tarballing process
      tarball.finalize();

      // Collect chunks of the tar file
      tarball.on("data", (chunk) => {
        chunks.push(chunk);
      });

      // When tarballing is complete, resolve the promise with the blob
      tarball.on("end", () => {
        const tarBuffer = Buffer.concat(chunks);
        resolve(tarBuffer);
      });

      // Handle errors
      tarball.on("error", reject);
    })();
  });
}
