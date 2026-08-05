// Minimal stand-in for the `vscode` module so that unit tests can import
// extension sources that pull it in at module load time. The configuration is
// backed by a mutable in-memory store so tests can drive and assert on the
// settings the extension reads and writes.
const configurationStore: Record<string, any> = {};

/** Replace the whole configuration store. Call from `beforeEach`. */
export function __resetConfiguration(values: Record<string, any> = {}) {
  for (const key of Object.keys(configurationStore)) {
    delete configurationStore[key];
  }
  Object.assign(configurationStore, values);
}

/** The current configuration, for assertions. */
export function __configuration(): Record<string, any> {
  return configurationStore;
}

/** Messages passed to `window.showInformationMessage`, for assertions. */
export const __informationMessages: string[] = [];

export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export const workspace = {
  fs: {},
  getConfiguration: (_section?: string) => ({
    get: (key: string) => configurationStore[key],
    update: async (key: string, value: any, _target?: ConfigurationTarget) => {
      configurationStore[key] = value;
    },
  }),
  workspaceFolders: undefined,
};

export const window = {
  showInformationMessage: (message: string) => {
    __informationMessages.push(message);
    return undefined;
  },
  showErrorMessage: () => undefined,
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
