import { loadConfigForPath } from "../config/config-manager";
import {
  __outputChannel,
  __setFileSystem,
  __setTextDocuments,
} from "./vscode-stub";

const ROOT = "file:///repo";

beforeEach(() => {
  __setFileSystem();
  __setTextDocuments();
});

function load(wmPath: string) {
  return loadConfigForPath(wmPath, ROOT, __outputChannel());
}

describe("loadConfigForPath", () => {
  it("reads the root wmill.yaml for a nested script", async () => {
    __setFileSystem({
      [`${ROOT}/wmill.yaml`]: [
        "defaultTs: deno",
        "nonDottedPaths: true",
        "codebases:",
        "  - relative_path: bundle",
        "workspaces:",
        "  cm:",
        "    baseUrl: https://windmill.example.net/",
        "    gitBranch: main",
        "    workspaceId: cm",
      ].join("\n"),
    });

    const config = await load("f/some/deep/script");
    expect(config.defaultTs).toBe("deno");
    expect(config.nonDottedPaths).toBe(true);
    expect(config.codebases).toEqual([{ relative_path: "bundle" }]);
    expect(config.workspaces).toEqual({
      cm: {
        baseUrl: "https://windmill.example.net/",
        gitBranch: "main",
        workspaceId: "cm",
      },
    });
  });

  it("prefers the root wmill.yaml over one nearer the script", async () => {
    // The search runs root-first and stops at the first hit
    __setFileSystem({
      [`${ROOT}/wmill.yaml`]: "defaultTs: deno",
      [`${ROOT}/f/wmill.yaml`]: "defaultTs: bun",
    });

    expect((await load("f/some/script")).defaultTs).toBe("deno");
  });

  it("falls back to a wmill.yaml nearer the script", async () => {
    __setFileSystem({ [`${ROOT}/f/wmill.yaml`]: "defaultTs: deno" });

    expect((await load("f/some/script")).defaultTs).toBe("deno");
  });

  it("searches up to the script's own directory", async () => {
    __setFileSystem({ [`${ROOT}/f/some/wmill.yaml`]: "defaultTs: deno" });

    expect((await load("f/some/script")).defaultTs).toBe("deno");
  });

  it("returns defaults when there is no wmill.yaml", async () => {
    const config = await load("f/some/script");
    expect(config).toEqual({
      defaultTs: "bun",
      codebases: [],
      workspaces: undefined,
      nonDottedPaths: false,
    });
  });

  it("returns defaults for an empty wmill.yaml", async () => {
    __setFileSystem({ [`${ROOT}/wmill.yaml`]: "" });

    const config = await load("f/some/script");
    expect(config.defaultTs).toBe("bun");
    expect(config.codebases).toEqual([]);
    expect(config.workspaces).toBeUndefined();
    expect(config.nonDottedPaths).toBe(false);
  });

  it("reads the deprecated gitBranches key", async () => {
    __setFileSystem({
      [`${ROOT}/wmill.yaml`]: [
        "gitBranches:",
        "  main:",
        "    baseUrl: https://windmill.example.net/",
        "    workspaceId: cm",
      ].join("\n"),
    });

    expect((await load("f/some/script")).workspaces).toEqual({
      main: { baseUrl: "https://windmill.example.net/", workspaceId: "cm" },
    });
  });

  it("names the key it found in the log", async () => {
    __setFileSystem({
      [`${ROOT}/wmill.yaml`]: "environments:\n  main:\n    workspaceId: cm",
    });

    const channel = __outputChannel();
    await loadConfigForPath("f/some/script", ROOT, channel);
    expect(channel.lines.some((l: string) => l.includes("environments:"))).toBe(true);
  });

  it("uses unsaved editor changes to wmill.yaml over what is on disk", async () => {
    __setFileSystem({ [`${ROOT}/wmill.yaml`]: "defaultTs: bun" });
    __setTextDocuments({ [`${ROOT}/wmill.yaml`]: "defaultTs: deno" });

    expect((await load("f/some/script")).defaultTs).toBe("deno");
  });

  it("handles a script at the repository root", async () => {
    __setFileSystem({ [`${ROOT}/wmill.yaml`]: "defaultTs: deno" });

    expect((await load("script")).defaultTs).toBe("deno");
  });
});
