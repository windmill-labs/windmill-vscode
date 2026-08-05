import * as vscode from "vscode";
import { fileExists, readTextFromUri } from "./file-utils";

// Branch prefix of workspace fork branches: `wm-fork/<base>/<id>`. The matching
// *workspace id* prefix is `wm-fork-` (see the CLI's utils/git.ts).
const WM_FORK_PREFIX = "wm-fork";

/**
 * Split a `wm-fork/<base>/<id>` branch into the base branch it was forked from
 * and the id of the fork workspace it targets. The base may itself contain
 * slashes. Returns undefined for any branch that isn't a well-formed fork branch.
 */
function parseForkBranch(
  branchName: string | undefined
): { base: string; forkWorkspaceId: string } | undefined {
  if (!branchName || !branchName.startsWith(`${WM_FORK_PREFIX}/`)) {
    return undefined;
  }

  const start = WM_FORK_PREFIX.length + 1;
  const end = branchName.lastIndexOf("/");

  if (end <= start) {
    return undefined;
  }

  const id = branchName.slice(end + 1);
  if (id.length === 0) {
    return undefined;
  }

  return { base: branchName.slice(start, end), forkWorkspaceId: `${WM_FORK_PREFIX}-${id}` };
}

/**
 * For a `wm-fork/<base>/<id>` branch, the base branch it was forked from.
 * Returns undefined for any other branch.
 */
export function getOriginalBranchForWorkspaceForks(
  branchName: string | undefined
): string | undefined {
  return parseForkBranch(branchName)?.base;
}

/**
 * For a `wm-fork/<base>/<id>` branch, the id of the fork workspace it targets.
 * Returns undefined for any other branch.
 */
export function getWorkspaceIdForWorkspaceForkFromBranchName(
  branchName: string | undefined
): string | undefined {
  return parseForkBranch(branchName)?.forkWorkspaceId;
}

/**
 * Find the .git directory in the workspace
 */
export async function getGitDir(workspaceFolder?: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
  // Check if running in web environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    console.log('Running in web environment, git operations not supported');
    return undefined;
  }

  if (!workspaceFolder) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    workspaceFolder = workspaceFolders[0];
  }

  const gitPath = vscode.Uri.joinPath(workspaceFolder.uri, '.git');
  
  try {
    const stat = await vscode.workspace.fs.stat(gitPath);
    if (stat.type === vscode.FileType.Directory) {
      return gitPath;
    }
    
    // Handle git worktrees - .git might be a file pointing to the actual git dir
    if (stat.type === vscode.FileType.File) {
      const content = await readTextFromUri(gitPath);
      const match = content.match(/^gitdir: (.+)$/m);
      if (match && match[1]) {
        // The path in .git file can be relative or absolute
        const gitDirPath = match[1].trim();
        if (gitDirPath.startsWith('/')) {
          return vscode.Uri.file(gitDirPath);
        } else {
          return vscode.Uri.joinPath(workspaceFolder.uri, gitDirPath);
        }
      }
    }
  } catch (error) {
    // .git directory doesn't exist
    return undefined;
  }

  return undefined;
}

/**
 * Get the current git branch name
 */
export async function getCurrentGitBranch(workspaceFolder?: vscode.WorkspaceFolder): Promise<string | undefined> {
  // Check if running in web environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    console.log('Running in web environment, git operations not supported');
    return undefined;
  }

  try {
    const gitDir = await getGitDir(workspaceFolder);
    if (!gitDir) {
      return undefined;
    }

    const headPath = vscode.Uri.joinPath(gitDir, 'HEAD');
    if (!await fileExists(headPath)) {
      return undefined;
    }

    const headContent = await readTextFromUri(headPath);
    
    // HEAD typically contains "ref: refs/heads/branch-name"
    const refMatch = headContent.trim().match(/^ref: refs\/heads\/(.+)$/);
    if (refMatch && refMatch[1]) {
      return refMatch[1];
    }

    // If HEAD is in detached state (contains a commit SHA), return undefined
    // We only support named branches for now
    return undefined;
  } catch (error) {
    console.error('Error reading git branch:', error);
    return undefined;
  }
}

/**
 * Get the path to the .git/HEAD file for watching
 */
export async function getGitHeadPath(workspaceFolder?: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
  const gitDir = await getGitDir(workspaceFolder);
  if (!gitDir) {
    return undefined;
  }
  return vscode.Uri.joinPath(gitDir, 'HEAD');
}

