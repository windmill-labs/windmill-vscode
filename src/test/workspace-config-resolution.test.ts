import {
  checkAndSwitchWorkspaceForGitBranch,
  getCurrentWorkspaceConfig,
  getWorkspacesFromVSCodeConfig,
} from "../workspace/workspace-manager";
import {
  __DIRECTORY,
  __outputChannel,
  __resetConfiguration,
  __setFileSystem,
  __setTextDocuments,
  __setWorkspaceFolders,
} from "./vscode-stub";

const ROOT = "file:///repo";
const REMOTE = "https://windmill.example.net/";

beforeEach(() => {
  __resetConfiguration();
  __setFileSystem();
  __setTextDocuments();
  __setWorkspaceFolders([ROOT]);
});

describe("getCurrentWorkspaceConfig", () => {
  it("uses the top-level settings for the main workspace", () => {
    __resetConfiguration({
      currentWorkspace: "main",
      remote: REMOTE,
      workspaceId: "cm",
      token: "main-token",
    });

    expect(getCurrentWorkspaceConfig()).toEqual({
      token: "main-token",
      workspace: "cm",
      remoteUrl: REMOTE,
      currentWorkspace: "main",
    });
  });

  it("defaults to the main workspace when none is selected", () => {
    __resetConfiguration({ remote: REMOTE, workspaceId: "cm", token: "main-token" });

    expect(getCurrentWorkspaceConfig().currentWorkspace).toBe("main");
  });

  it("appends a trailing slash to the remote", () => {
    __resetConfiguration({
      currentWorkspace: "main",
      remote: "https://windmill.example.net",
      workspaceId: "cm",
      token: "main-token",
    });

    expect(getCurrentWorkspaceConfig().remoteUrl).toBe(REMOTE);
  });

  it("uses the named workspace when one is selected", () => {
    __resetConfiguration({
      currentWorkspace: "cm-prod",
      remote: "https://other.example.net/",
      workspaceId: "other",
      token: "other-token",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    expect(getCurrentWorkspaceConfig()).toEqual({
      token: "cm-token",
      workspace: "cm",
      remoteUrl: REMOTE,
      currentWorkspace: "cm-prod",
    });
  });

  it("throws when the selected workspace is not configured", () => {
    __resetConfiguration({ currentWorkspace: "gone", additionalWorkspaces: [] });

    expect(() => getCurrentWorkspaceConfig()).toThrow("gone");
  });
});

describe("getWorkspacesFromVSCodeConfig", () => {
  it("exposes the top-level settings as a synthetic main workspace", () => {
    __resetConfiguration({
      remote: REMOTE,
      workspaceId: "cm",
      token: "main-token",
      additionalWorkspaces: [],
    });

    expect(getWorkspacesFromVSCodeConfig()).toEqual([
      { name: "main", remote: REMOTE, workspaceId: "cm", token: "main-token" },
    ]);
  });

  it("omits the synthetic entry when a profile already covers it", () => {
    // After a CLI sync the top-level settings duplicate the active profile; a
    // synthetic "main" would shadow that profile's real name.
    __resetConfiguration({
      remote: "https://windmill.example.net",
      workspaceId: "cm",
      token: "cm-token",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    expect(getWorkspacesFromVSCodeConfig().map((w) => w.name)).toEqual(["cm-prod"]);
  });

  it("returns only the profiles when the top-level settings are incomplete", () => {
    __resetConfiguration({
      remote: REMOTE,
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    expect(getWorkspacesFromVSCodeConfig().map((w) => w.name)).toEqual(["cm-prod"]);
  });
});

describe("checkAndSwitchWorkspaceForGitBranch", () => {
  const wmillYaml = [
    "workspaces:",
    "  cm:",
    "    baseUrl: https://windmill.example.net/",
    "    gitBranch: main",
    "    workspaceId: cm",
  ].join("\n");

  function onBranch(branch: string) {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: `ref: refs/heads/${branch}\n`,
      [`${ROOT}/wmill.yaml`]: wmillYaml,
    });
  }

  it("loads wmill.yaml and switches for the current branch", async () => {
    onBranch("main");
    __resetConfiguration({
      currentWorkspace: "ir",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    const result = await checkAndSwitchWorkspaceForGitBranch(__outputChannel(), undefined);
    expect(result.switched).toBe(true);
    // The loaded config is handed back for caching
    expect(result.config).toEqual({
      cm: { baseUrl: REMOTE, gitBranch: "main", workspaceId: "cm" },
    });
  });

  it("uses the cached config instead of re-reading wmill.yaml", async () => {
    // Only .git exists: a reload would find no config and not switch
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
    });
    __resetConfiguration({
      currentWorkspace: "ir",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    const cached = { cm: { baseUrl: REMOTE, gitBranch: "main", workspaceId: "cm" } };
    const result = await checkAndSwitchWorkspaceForGitBranch(__outputChannel(), cached);
    expect(result.switched).toBe(true);
  });

  it("does nothing outside a git repository", async () => {
    __setFileSystem({ [`${ROOT}/wmill.yaml`]: wmillYaml });

    const channel = __outputChannel();
    expect(await checkAndSwitchWorkspaceForGitBranch(channel, undefined)).toEqual({
      switched: false,
    });
    expect(channel.lines).toContain("No git branch detected or not in a git repository");
  });

  it("does nothing without a workspace folder", async () => {
    onBranch("main");
    __setWorkspaceFolders([]);

    expect(await checkAndSwitchWorkspaceForGitBranch(__outputChannel(), undefined)).toEqual(
      { switched: false }
    );
  });

  it("reports when wmill.yaml has no workspaces section", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
      [`${ROOT}/wmill.yaml`]: "defaultTs: bun",
    });

    const channel = __outputChannel();
    const result = await checkAndSwitchWorkspaceForGitBranch(channel, undefined);
    expect(result).toEqual({ switched: false, config: undefined });
    expect(channel.lines).toContain("No workspaces configuration found in wmill.yaml");
  });

  it("keeps the current workspace on an unconfigured branch", async () => {
    onBranch("dev");
    __resetConfiguration({
      currentWorkspace: "ir",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    const result = await checkAndSwitchWorkspaceForGitBranch(__outputChannel(), undefined);
    expect(result.switched).toBe(false);
    // The config is still cached for the next check
    expect(result.config).toBeDefined();
  });

  it("survives a wmill.yaml that is not valid YAML", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
      [`${ROOT}/wmill.yaml`]: "workspaces:\n  cm:\n   baseUrl: [unclosed\n",
    });

    const channel = __outputChannel();
    const result = await checkAndSwitchWorkspaceForGitBranch(channel, undefined);
    expect(result).toEqual({ switched: false });
    expect(
      channel.lines.some((l: string) => l.includes("Error checking git branch"))
    ).toBe(true);
    jest.restoreAllMocks();
  });

  it("switches to the fork workspace on a fork branch", async () => {
    onBranch("wm-fork/main/abc");
    __resetConfiguration({
      currentWorkspace: "ir",
      additionalWorkspaces: [
        { name: "cm-prod", remote: REMOTE, workspaceId: "cm", token: "cm-token" },
      ],
    });

    const result = await checkAndSwitchWorkspaceForGitBranch(__outputChannel(), undefined);
    expect(result.switched).toBe(true);
  });
});
