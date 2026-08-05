// Minimal stand-in for the `vscode` module so that unit tests can import
// extension sources that pull it in at module load time.
export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export const workspace = {
  fs: {},
  getConfiguration: () => ({ get: () => undefined }),
  workspaceFolders: undefined,
};

export const window = {
  showInformationMessage: () => undefined,
  showErrorMessage: () => undefined,
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
