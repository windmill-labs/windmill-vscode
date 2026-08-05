import {
  getCurrentGitBranch,
  getGitDir,
  getGitHeadPath,
} from "../utils/git-utils";
import { __DIRECTORY, __setFileSystem, __setWorkspaceFolders } from "./vscode-stub";

const ROOT = "file:///repo";

beforeEach(() => {
  __setWorkspaceFolders([ROOT]);
  __setFileSystem();
});

describe("getCurrentGitBranch", () => {
  it("reads the branch from .git/HEAD", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
    });

    expect(await getCurrentGitBranch()).toBe("main");
  });

  it("supports branch names containing slashes", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/wm-fork/main/abc\n",
    });

    expect(await getCurrentGitBranch()).toBe("wm-fork/main/abc");
  });

  it("returns undefined on a detached HEAD", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "9fceb02d0ae598e95dc970b74767f19372d61af8\n",
    });

    expect(await getCurrentGitBranch()).toBeUndefined();
  });

  it("returns undefined outside a git repository", async () => {
    __setFileSystem({ [`${ROOT}/wmill.yaml`]: "defaultTs: bun" });

    expect(await getCurrentGitBranch()).toBeUndefined();
  });

  it("returns undefined when HEAD is missing", async () => {
    __setFileSystem({ [`${ROOT}/.git`]: __DIRECTORY });

    expect(await getCurrentGitBranch()).toBeUndefined();
  });

  it("returns undefined without a workspace folder", async () => {
    __setWorkspaceFolders([]);

    expect(await getCurrentGitBranch()).toBeUndefined();
  });

  it("returns undefined when HEAD cannot be read", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      // Present, but unreadable as text
      [`${ROOT}/.git/HEAD`]: __DIRECTORY,
    });

    expect(await getCurrentGitBranch()).toBeUndefined();
    jest.restoreAllMocks();
  });

  it("tolerates trailing whitespace in HEAD", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "  ref: refs/heads/main  \n\n",
    });

    expect(await getCurrentGitBranch()).toBe("main");
  });
});

describe("getCurrentGitBranch in a worktree", () => {
  it("follows an absolute gitdir pointer", async () => {
    __setFileSystem({
      // In a worktree, .git is a file pointing at the real git dir
      [`${ROOT}/.git`]: "gitdir: /repo/.git/worktrees/feature\n",
      ["file:///repo/.git/worktrees/feature/HEAD"]: "ref: refs/heads/feature\n",
    });

    expect(await getCurrentGitBranch()).toBe("feature");
  });

  it("follows a gitdir pointer relative to the workspace folder", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: "gitdir: ../main-checkout/.git/worktrees/feature\n",
      ["file:///main-checkout/.git/worktrees/feature/HEAD"]: "ref: refs/heads/feature\n",
    });

    expect(await getCurrentGitBranch()).toBe("feature");
  });

  it("returns undefined when the .git file is not a gitdir pointer", async () => {
    __setFileSystem({ [`${ROOT}/.git`]: "not a gitdir pointer\n" });

    expect(await getCurrentGitBranch()).toBeUndefined();
  });

  it("returns undefined when the pointed-at git dir has no HEAD", async () => {
    __setFileSystem({ [`${ROOT}/.git`]: "gitdir: /repo/.git/worktrees/gone\n" });

    expect(await getCurrentGitBranch()).toBeUndefined();
  });
});

describe("getGitDir and getGitHeadPath", () => {
  it("resolves the git directory and its HEAD", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: __DIRECTORY,
      [`${ROOT}/.git/HEAD`]: "ref: refs/heads/main\n",
    });

    expect((await getGitDir())?.toString()).toBe(`${ROOT}/.git`);
    expect((await getGitHeadPath())?.toString()).toBe(`${ROOT}/.git/HEAD`);
  });

  it("resolves HEAD inside the worktree's git dir", async () => {
    __setFileSystem({
      [`${ROOT}/.git`]: "gitdir: /repo/.git/worktrees/feature\n",
    });

    expect((await getGitHeadPath())?.toString()).toBe(
      "file:///repo/.git/worktrees/feature/HEAD"
    );
  });

  it("returns undefined when there is no .git", async () => {
    expect(await getGitDir()).toBeUndefined();
    expect(await getGitHeadPath()).toBeUndefined();
  });
});
