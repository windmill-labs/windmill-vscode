import {
  extractWorkspacesConfig,
  findWorkspaceByGitBranch,
  getEffectiveGitBranch,
  getEffectiveWorkspaceId,
} from "../config/config-manager";

describe("extractWorkspacesConfig", () => {
  it("reads the `workspaces` key", () => {
    const result = extractWorkspacesConfig({
      workspaces: { cm: { baseUrl: "https://windmill.example.net/" } },
    });
    expect(result?.key).toBe("workspaces");
    expect(Object.keys(result!.workspaces)).toEqual(["cm"]);
  });

  it("falls back to the deprecated keys", () => {
    for (const key of ["gitBranches", "environments", "git_branches"]) {
      const result = extractWorkspacesConfig({
        [key]: { main: { baseUrl: "https://windmill.example.net/", workspaceId: "cm" } },
      });
      expect(result?.key).toBe(key);
      expect(result?.workspaces.main.workspaceId).toBe("cm");
    }
  });

  it("prefers `workspaces` over the deprecated keys", () => {
    const result = extractWorkspacesConfig({
      workspaces: { cm: { baseUrl: "https://new.example.net/" } },
      gitBranches: { main: { baseUrl: "https://old.example.net/" } },
    });
    expect(result?.key).toBe("workspaces");
  });

  it("returns undefined when no workspaces config is present", () => {
    expect(extractWorkspacesConfig({ defaultTs: "bun" })).toBeUndefined();
    expect(extractWorkspacesConfig(undefined)).toBeUndefined();
  });
});

describe("findWorkspaceByGitBranch", () => {
  it("matches on the explicit gitBranch of a workspace", () => {
    // The workspace name (`cm`) differs from the branch it is bound to (`main`)
    const workspaces = {
      cm: {
        baseUrl: "https://windmill.example.net/",
        gitBranch: "main",
        workspaceId: "cm",
      },
    };
    const match = findWorkspaceByGitBranch(workspaces, "main");
    expect(match?.[0]).toBe("cm");
    expect(match?.[1].workspaceId).toBe("cm");
    expect(findWorkspaceByGitBranch(workspaces, "cm")).toBeUndefined();
  });

  it("falls back to the workspace name when gitBranch is omitted", () => {
    const workspaces = { main: { baseUrl: "https://windmill.example.net/" } };
    expect(findWorkspaceByGitBranch(workspaces, "main")?.[0]).toBe("main");
  });

  it("ignores reserved keys", () => {
    const workspaces = {
      commonSpecificItems: { settings: true } as any,
      main: { baseUrl: "https://windmill.example.net/" },
    };
    expect(findWorkspaceByGitBranch(workspaces, "commonSpecificItems")).toBeUndefined();
    expect(findWorkspaceByGitBranch(workspaces, "main")?.[0]).toBe("main");
  });

  it("returns undefined for an unknown branch or missing config", () => {
    expect(findWorkspaceByGitBranch({ main: {} }, "dev")).toBeUndefined();
    expect(findWorkspaceByGitBranch(undefined, "main")).toBeUndefined();
  });
});

describe("effective workspace fields", () => {
  it("defaults gitBranch and workspaceId to the workspace name", () => {
    expect(getEffectiveGitBranch("staging", {})).toBe("staging");
    expect(getEffectiveWorkspaceId("staging", {})).toBe("staging");
  });

  it("uses the explicit values when set", () => {
    expect(getEffectiveGitBranch("cm", { gitBranch: "main" })).toBe("main");
    expect(getEffectiveWorkspaceId("cm", { workspaceId: "cm-prod" })).toBe("cm-prod");
  });
});
