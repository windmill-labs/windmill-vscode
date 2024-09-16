export async function testBundle(
  path: string | undefined,
  contents: string,
  id: string,
  appendLine: (x: string) => void,
  codebase: any | undefined,
  rootPath: string | undefined,
  format: "cjs" | "esm",
  platform: "node" | "browser",
  command: string,
  postMessage?: (x: any) => void
) {
  appendLine("testBundle not available in web version");
  postMessage?.({
    type: "testBundleError",
    error: "Bundle not available in web version",
  });
}
