import * as esbuild from "esbuild";
export async function testBundle(
  path: string | undefined,
  contents: string,
  id: string,
  appendLine: (x: string) => void,
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
    // let url = vscode.Uri.joinPath(
    //   context.extensionUri,
    //   "node_modules/esbuild-wasm/esbuild.wasm"
    // );
    // appendLine("testBundle wasm url: " + url.toString());
    // await esbuild.initialize({
    //   wasmURL: url.toString(),
    // });

    // function createPlugin(): esbuild.Plugin {
    //   return {
    //     name: "example",

    //     async setup(build: esbuild.PluginBuild) {
    //       build.onLoad({ filter: /.*/ }, async (args: any) => {
    //         appendLine("onLoad" + JSON.stringify(args));
    //         const path = vscode.Uri.parse(args.path);
    //         appendLine("onLoad path: " + path);
    //         const contents = await vscode.workspace.fs.readFile(path);
    //         appendLine("onLoad contents: " + contents);
    //         return {
    //           contents: contents,
    //           loader: "default",
    //         };
    //       });
    //       build.onResolve({ filter: /.*/ }, async (args: any) => {
    //         appendLine("onResolve" + JSON.stringify(args));

    //         const uri = vscode.Uri.joinPath(
    //           vscode.Uri.parse(args.resolveDir),
    //           args.path
    //         );
    //         let exists = true;
    //         try {
    //           await vscode.workspace.fs.stat(uri);
    //         } catch (e) {
    //           exists = false;
    //         }
    //         appendLine(
    //           "onResolve uri: " + uri + " exists: " + exists
    //         );
    //         if (exists) {
    //           return { path: uri.path };
    //         }

    //         return undefined;
    //       });
    //     },
    //   };
    // }
    let splitted = path.split("/");
    let sourcefile = splitted[splitted.length - 1];
    let resolveDir = splitted.slice(0, splitted.length - 1).join("/");
    const out = await esbuild.build({
      format: "esm",
      bundle: true,
      stdin: {
        contents,
        resolveDir,
        sourcefile,
        loader: "ts",
      },
      write: false,
    });
    appendLine("testBundle bundled: " + path);
    postMessage?.({
      type: "testBundle",
      id: id,
      file: out.outputFiles[0].text,
    });
    appendLine("sent" + postMessage);
  } catch (e) {
    appendLine("testBundle error: " + e);
    postMessage?.({
      type: "testBundleError",
      error: e,
    });
  }
}
