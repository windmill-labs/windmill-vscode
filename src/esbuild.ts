import * as esbuild from "esbuild-wasm";

let initialized = false;

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
    if (!initialized) {
      await esbuild.initialize({});
      initialized = true;
    }

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
      platform: "node",
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
