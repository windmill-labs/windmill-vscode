import { getLastUsedProfile } from "../config/branch-profiles";
import { getCurrentGitBranch, getGitDir } from "../utils/git-utils";
import { getWorkspacesFromConfig } from "../workspace/workspace-manager";
import { __DIRECTORY, __setFileSystem, __setWorkspaceFolders } from "./vscode-stub";

// In the web extension host there is no node filesystem: the webpack build
// stubs `fs` out entirely, so every path that would touch it must bail out on
// this check rather than throwing.
const originalVersions = process.versions;
const ROOT = "file:///repo";

beforeEach(() => {
  __setWorkspaceFolders([ROOT]);
  __setFileSystem({
    [`${ROOT}/.git`]: __DIRECTORY,
    [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
  });
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  Object.defineProperty(process, "versions", { value: undefined, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "versions", {
    value: originalVersions,
    configurable: true,
  });
  jest.restoreAllMocks();
});

describe("without a node runtime", () => {
  it("reads no CLI workspaces", async () => {
    expect(await getWorkspacesFromConfig()).toEqual({ workspaces: [], active: "" });
  });

  it("reads no remembered profile", async () => {
    expect(
      await getLastUsedProfile("cm", "https://windmill.example.net/", "cm")
    ).toBeUndefined();
  });

  it("detects no git branch, even with a .git present", async () => {
    expect(await getCurrentGitBranch()).toBeUndefined();
    expect(await getGitDir()).toBeUndefined();
  });
});
