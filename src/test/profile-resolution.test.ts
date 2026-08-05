import { switchWorkspaceForBranch } from "../workspace/workspace-manager";
import { WorkspacesConfig } from "../config/config-manager";
import { getLastUsedProfile } from "../config/branch-profiles";
import {
  __configuration,
  __informationMessages,
  __outputChannel,
  __resetConfiguration,
} from "./vscode-stub";

jest.mock("../config/branch-profiles", () => ({
  getLastUsedProfile: jest.fn(),
}));

const mockedGetLastUsedProfile = getLastUsedProfile as jest.MockedFunction<
  typeof getLastUsedProfile
>;

const REMOTE = "https://windmill.example.net/";

// Two profiles for the same workspace on the same instance, differing only by
// token — i.e. the same workspace reached as two different identities.
const PERSONAL = { name: "cm-personal", remote: REMOTE, workspaceId: "cm", token: "t1" };
const SERVICE = { name: "cm-service", remote: REMOTE, workspaceId: "cm", token: "t2" };

const workspaces: WorkspacesConfig = {
  cm: { baseUrl: REMOTE, gitBranch: "main", workspaceId: "cm" },
};

beforeEach(() => {
  mockedGetLastUsedProfile.mockReset();
  __informationMessages.length = 0;
  __resetConfiguration({
    additionalWorkspaces: [PERSONAL, SERVICE],
    currentWorkspace: "other",
  });
});

describe("resolving between several matching workspaces", () => {
  it("follows the choice the CLI remembered", async () => {
    mockedGetLastUsedProfile.mockResolvedValue("cm-service");

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-service");
    // Keyed by the wmill.yaml workspace name, its baseUrl and workspace id
    expect(mockedGetLastUsedProfile).toHaveBeenCalledWith("cm", REMOTE, "cm", undefined);
    // Not ambiguous once resolved: no extra nudge in the notification
    expect(__informationMessages).toEqual(['Switched to workspace "cm-service"']);
  });

  it("passes the configFolder override through to the CLI config lookup", async () => {
    __resetConfiguration({
      additionalWorkspaces: [PERSONAL, SERVICE],
      currentWorkspace: "other",
      configFolder: "/custom/config",
    });
    mockedGetLastUsedProfile.mockResolvedValue("cm-service");

    await switchWorkspaceForBranch("main", workspaces);
    expect(mockedGetLastUsedProfile).toHaveBeenCalledWith("cm", REMOTE, "cm", "/custom/config");
  });

  it("falls back to the first match and says so when nothing is remembered", async () => {
    mockedGetLastUsedProfile.mockResolvedValue(undefined);

    const channel = __outputChannel();
    expect(await switchWorkspaceForBranch("main", workspaces, channel)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-personal");
    expect(__informationMessages[0]).toContain("cm-personal");
    expect(__informationMessages[0]).toContain("Windmill: Switch workspace");
    // The log names every candidate so the user can tell them apart
    expect(
      channel.lines.some(
        (l: string) => l.includes("cm-personal") && l.includes("cm-service")
      )
    ).toBe(true);
  });

  it("falls back when the remembered profile is no longer configured", async () => {
    mockedGetLastUsedProfile.mockResolvedValue("cm-deleted");

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-personal");
    expect(__informationMessages[0]).toContain("Windmill: Switch workspace");
  });

  it("does not consult the CLI config when only one workspace matches", async () => {
    __resetConfiguration({ additionalWorkspaces: [PERSONAL], currentWorkspace: "other" });

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-personal");
    expect(mockedGetLastUsedProfile).not.toHaveBeenCalled();
  });

  it("does not notify when already on the resolved workspace", async () => {
    __resetConfiguration({
      additionalWorkspaces: [PERSONAL, SERVICE],
      currentWorkspace: "cm-service",
    });
    mockedGetLastUsedProfile.mockResolvedValue("cm-service");

    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__informationMessages).toEqual([]);
  });

  it("keeps working when the CLI config cannot be read", async () => {
    mockedGetLastUsedProfile.mockRejectedValue(new Error("EACCES"));

    // The read is best-effort, but a rejection must not leave the workspace unswitched
    expect(await switchWorkspaceForBranch("main", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-personal");
  });

  it("resolves the parent identity before deriving a fork workspace", async () => {
    mockedGetLastUsedProfile.mockResolvedValue("cm-service");

    expect(await switchWorkspaceForBranch("wm-fork/main/abc", workspaces)).toBe(true);
    expect(__configuration().currentWorkspace).toBe("cm-service/wm-fork-abc");

    const registered = __configuration().additionalWorkspaces.find(
      (w: any) => w.name === "cm-service/wm-fork-abc"
    );
    // The fork inherits the chosen identity's token, not the first match's
    expect(registered.token).toBe("t2");
  });
});
