import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getWorkspacesFromConfig,
  syncVSCodeConfigFromCLI,
} from "../workspace/workspace-manager";
import {
  __configuration,
  __failConfigurationUpdates,
  __outputChannel,
  __resetConfiguration,
} from "./vscode-stub";

// The CLI config is read through node's fs, so these run against a real
// temporary config dir laid out the way the CLI writes it.
let configFolder: string;

function writeCliConfig(remotes: any[], active: string) {
  const dir = path.join(configFolder, "windmill");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "remotes.ndjson"),
    remotes.map((r) => JSON.stringify(r)).join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "activeWorkspace"), active, "utf8");
}

const CM = {
  name: "cm-prod",
  remote: "https://windmill.example.net/",
  workspaceId: "cm",
  token: "token-cm",
};
const IR = {
  name: "ir",
  remote: "https://windmill.example.net/",
  workspaceId: "ir",
  token: "token-ir",
};

beforeEach(() => {
  configFolder = fs.mkdtempSync(path.join(os.tmpdir(), "wm-vscode-test-"));
  __resetConfiguration({ configFolder });
  // The missing/invalid config cases log to console.error by design
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(configFolder, { recursive: true, force: true });
});

describe("getWorkspacesFromConfig", () => {
  it("reads the workspaces and the active one", async () => {
    writeCliConfig([CM, IR], "ir");

    expect(await getWorkspacesFromConfig(configFolder)).toEqual({
      workspaces: [CM, IR],
      active: "ir",
    });
  });

  it("ignores blank lines and a trailing newline", async () => {
    const dir = path.join(configFolder, "windmill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "remotes.ndjson"),
      `${JSON.stringify(CM)}\n\n${JSON.stringify(IR)}\n`,
      "utf8"
    );
    fs.writeFileSync(path.join(dir, "activeWorkspace"), "cm-prod", "utf8");

    const { workspaces } = await getWorkspacesFromConfig(configFolder);
    expect(workspaces).toEqual([CM, IR]);
  });

  it("returns nothing when the config files are missing", async () => {
    expect(await getWorkspacesFromConfig(configFolder)).toEqual({
      workspaces: [],
      active: "",
    });
  });

  it("returns nothing when a line is not valid JSON", async () => {
    const dir = path.join(configFolder, "windmill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "remotes.ndjson"), "{not json}", "utf8");
    fs.writeFileSync(path.join(dir, "activeWorkspace"), "cm-prod", "utf8");

    expect(await getWorkspacesFromConfig(configFolder)).toEqual({
      workspaces: [],
      active: "",
    });
  });
});

describe("syncVSCodeConfigFromCLI", () => {
  it("copies the active workspace into the VSCode settings", async () => {
    writeCliConfig([CM, IR], "ir");

    const result = await syncVSCodeConfigFromCLI(__outputChannel());
    expect(result.synced).toBe(true);
    expect(result.workspaces).toEqual([CM, IR]);

    const conf = __configuration();
    expect(conf.remote).toBe(IR.remote);
    expect(conf.workspaceId).toBe(IR.workspaceId);
    expect(conf.token).toBe(IR.token);
    expect(conf.currentWorkspace).toBe("ir");
    // Every CLI profile becomes selectable, not just the active one
    expect(conf.additionalWorkspaces).toEqual([CM, IR]);
  });

  it("does not sync when the active workspace is not in the list", async () => {
    writeCliConfig([CM], "deleted-profile");

    const result = await syncVSCodeConfigFromCLI(__outputChannel());
    expect(result.synced).toBe(false);
    // The workspaces are still reported, but nothing is written
    expect(result.workspaces).toEqual([CM]);
    expect(__configuration().currentWorkspace).toBeUndefined();
    expect(__configuration().additionalWorkspaces).toBeUndefined();
  });

  it("does not sync when there is no CLI config", async () => {
    const result = await syncVSCodeConfigFromCLI(__outputChannel());
    expect(result).toEqual({ workspaces: [], synced: false });
    expect(__configuration().currentWorkspace).toBeUndefined();
  });

  it("leaves an existing VSCode workspace selection alone when there is no CLI config", async () => {
    __resetConfiguration({ configFolder, currentWorkspace: "manually-configured" });

    await syncVSCodeConfigFromCLI(__outputChannel());
    expect(__configuration().currentWorkspace).toBe("manually-configured");
  });

  it("reports a failed settings write instead of throwing", async () => {
    writeCliConfig([CM, IR], "ir");
    __failConfigurationUpdates(new Error("settings are read-only"));

    const channel = __outputChannel();
    expect(await syncVSCodeConfigFromCLI(channel)).toEqual({
      workspaces: [],
      synced: false,
    });
    expect(
      channel.lines.some((l: string) => l.includes("settings are read-only"))
    ).toBe(true);
  });

  it("logs what it synced", async () => {
    writeCliConfig([CM, IR], "ir");

    const channel = __outputChannel();
    await syncVSCodeConfigFromCLI(channel);
    expect(channel.lines).toContain("Synced 2 workspace(s) from CLI config");
    expect(channel.lines).toContain("Active workspace: ir");
  });
});
