import { switchWorkspaceForBranch } from "../workspace/workspace-manager";
import { WorkspacesConfig } from "../config/config-manager";
import { __configuration, __resetConfiguration } from "./vscode-stub";

const REMOTE = "https://windmill.example.net/";

/** A CLI-synced workspace profile as it lands in `additionalWorkspaces`. */
function profile(name: string, workspaceId: string, remote = REMOTE) {
  return { name, remote, workspaceId, token: `token-${name}` };
}

/**
 * Settings with no top-level remote/workspaceId/token, so that
 * getWorkspacesFromVSCodeConfig doesn't add a synthetic "main" entry.
 */
function settings(additionalWorkspaces: any[], currentWorkspace = "other") {
  return { additionalWorkspaces, currentWorkspace };
}

beforeEach(() => {
  __resetConfiguration();
});

describe("switchWorkspaceForBranch", () => {
  it("switches to the profile bound to the branch", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")]));
    const workspaces: WorkspacesConfig = {
      cm: { baseUrl: REMOTE, gitBranch: "main", workspaceId: "cm" },
    };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    // The profile name, not the wmill.yaml workspace name
    expect(__configuration().currentWorkspace).toBe("cm-prod");
  });

  it("defaults workspaceId to the workspace name", async () => {
    __resetConfiguration(settings([profile("staging-profile", "staging")]));
    const workspaces: WorkspacesConfig = { staging: { baseUrl: REMOTE } };

    expect(await switchWorkspaceForBranch("staging", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("staging-profile");
  });

  it("matches remotes that differ only by trailing slash", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm", "https://windmill.example.net")]));
    const workspaces: WorkspacesConfig = {
      cm: { baseUrl: "https://windmill.example.net", gitBranch: "main" },
    };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-prod");
  });

  it("keeps the current workspace when the branch is not configured", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));
    const workspaces: WorkspacesConfig = { cm: { baseUrl: REMOTE, gitBranch: "main" } };

    expect(await switchWorkspaceForBranch("dev", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });

  it("keeps the current workspace when no profile matches", async () => {
    __resetConfiguration(settings([profile("other-instance", "cm", "https://other.example.net/")], "ir"));
    const workspaces: WorkspacesConfig = { cm: { baseUrl: REMOTE, gitBranch: "main" } };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });

  it("keeps the current workspace when the entry has no baseUrl", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));
    const workspaces: WorkspacesConfig = { cm: { gitBranch: "main", workspaceId: "cm" } };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });

  it("is a no-op when already on the target workspace", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "cm-prod"));
    const workspaces: WorkspacesConfig = { cm: { baseUrl: REMOTE, gitBranch: "main" } };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-prod");
  });

  it("does nothing without a branch or a workspaces config", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));
    expect(await switchWorkspaceForBranch("", { cm: { baseUrl: REMOTE } })).toBe(false);
    expect(await switchWorkspaceForBranch("main", undefined)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });

  it("uses the first workspace when several map to the same branch", async () => {
    // The CLI warns and uses the first; this documents the same precedence here.
    __resetConfiguration(settings([profile("first", "one"), profile("second", "two")]));
    const workspaces: WorkspacesConfig = {
      one: { baseUrl: REMOTE, gitBranch: "main" },
      two: { baseUrl: REMOTE, gitBranch: "main" },
    };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("first");
  });

  it("can select the top-level workspace when it has no CLI profile", async () => {
    // With no additionalWorkspaces entry for it, the top-level settings are
    // exposed as a synthetic "main" workspace.
    __resetConfiguration({
      additionalWorkspaces: [],
      currentWorkspace: "other",
      remote: REMOTE,
      workspaceId: "cm",
      token: "main-token",
    });
    const workspaces: WorkspacesConfig = { cm: { baseUrl: REMOTE, gitBranch: "main" } };

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("main");
  });

  it("ignores the reserved commonSpecificItems key", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));
    const workspaces: WorkspacesConfig = {
      commonSpecificItems: { settings: true } as any,
      cm: { baseUrl: REMOTE, gitBranch: "main" },
    };

    expect(await switchWorkspaceForBranch("commonSpecificItems", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });
});

describe("switchWorkspaceForBranch on fork branches", () => {
  const workspaces: WorkspacesConfig = {
    cm: { baseUrl: REMOTE, gitBranch: "main", workspaceId: "cm" },
  };

  it("targets the fork workspace, reusing the parent's remote and auth", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));

    expect(await switchWorkspaceForBranch("wm-fork/main/abc", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-prod/wm-fork-abc");

    const registered = __configuration().additionalWorkspaces.find(
      (w: any) => w.name === "cm-prod/wm-fork-abc"
    );
    expect(registered).toEqual({
      name: "cm-prod/wm-fork-abc",
      remote: REMOTE,
      workspaceId: "wm-fork-abc",
      token: "token-cm-prod",
    });
    // The parent profile is left untouched
    expect(__configuration().additionalWorkspaces).toContainEqual(profile("cm-prod", "cm"));
  });

  it("re-registers the fork entry after a CLI sync wipes additionalWorkspaces", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));
    await switchWorkspaceForBranch("wm-fork/main/abc", workspaces);

    // syncVSCodeConfigFromCLI rewrites additionalWorkspaces from the CLI profiles,
    // dropping the derived fork entry, and resets currentWorkspace to the CLI active one.
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));

    expect(await switchWorkspaceForBranch("wm-fork/main/abc", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-prod/wm-fork-abc");
    expect(
      __configuration().additionalWorkspaces.filter(
        (w: any) => w.name === "cm-prod/wm-fork-abc"
      )
    ).toHaveLength(1);
  });

  it("refreshes the fork entry when the parent's token changed", async () => {
    __resetConfiguration(
      settings(
        [
          profile("cm-prod", "cm"),
          {
            name: "cm-prod/wm-fork-abc",
            remote: REMOTE,
            workspaceId: "wm-fork-abc",
            token: "stale-token",
          },
        ],
        "ir"
      )
    );

    expect(await switchWorkspaceForBranch("wm-fork/main/abc", workspaces)).toBe(true);
    const registered = __configuration().additionalWorkspaces.find(
      (w: any) => w.name === "cm-prod/wm-fork-abc"
    );
    expect(registered.token).toBe("token-cm-prod");
    expect(__configuration().additionalWorkspaces).toHaveLength(2);
  });

  it("keeps the current workspace when the base branch is not configured", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));

    expect(await switchWorkspaceForBranch("wm-fork/dev/abc", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
    expect(__configuration().additionalWorkspaces).toHaveLength(1);
  });

  it("treats a malformed fork branch as a plain branch", async () => {
    __resetConfiguration(settings([profile("cm-prod", "cm")], "ir"));

    // No fork id: must not silently fall through to the parent workspace
    expect(await switchWorkspaceForBranch("wm-fork/main/", workspaces)).toBe(false);
    expect(__configuration().currentWorkspace).toBe("ir");
  });
});
