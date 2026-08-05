/* eslint-disable @typescript-eslint/naming-convention */
// Names here mirror the `vscode` API surface, plus `__`-prefixed test hooks.
//
// Minimal stand-in for the `vscode` module so that unit tests can import
// extension sources that pull it in at module load time. The configuration and
// the filesystem are backed by mutable in-memory stores so tests can drive and
// assert on what the extension reads and writes.

// ---------------------------------------------------------------- configuration

const configurationStore: Record<string, any> = {};

let configurationUpdateError: Error | undefined;

/** Replace the whole configuration store. Call from `beforeEach`. */
export function __resetConfiguration(values: Record<string, any> = {}) {
  for (const key of Object.keys(configurationStore)) {
    delete configurationStore[key];
  }
  Object.assign(configurationStore, values);
  configurationUpdateError = undefined;
}

/** Make subsequent configuration writes fail, to exercise error handling. */
export function __failConfigurationUpdates(error: Error) {
  configurationUpdateError = error;
}

/** The current configuration, for assertions. */
export function __configuration(): Record<string, any> {
  return configurationStore;
}

/** Messages passed to `window.showInformationMessage`, for assertions. */
export const __informationMessages: string[] = [];

// ------------------------------------------------------------------ filesystem

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/** Marks an entry of the in-memory filesystem as a directory. */
export const __DIRECTORY = { directory: true } as const;

type FileSystemEntry = string | typeof __DIRECTORY;

const fileSystem = new Map<string, FileSystemEntry>();

/**
 * Collapse duplicate slashes and resolve `.`/`..`, the way a real filesystem
 * does with the paths this extension builds by string concatenation.
 */
function normalizePath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const resolved: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === ".." && resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return (isAbsolute ? "/" : "") + resolved.join("/");
}

function normalizeUriString(value: string): string {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd === -1) {
    return normalizePath(value);
  }
  const scheme = value.slice(0, schemeEnd + 3);
  return scheme + normalizePath(value.slice(schemeEnd + 3));
}

/** Replace the whole in-memory filesystem. Keys are URI strings or paths. */
export function __setFileSystem(entries: Record<string, FileSystemEntry> = {}) {
  fileSystem.clear();
  for (const [key, value] of Object.entries(entries)) {
    fileSystem.set(normalizeUriString(key), value);
  }
}

// ------------------------------------------------------------------------- Uri

export type StubUri = {
  scheme: string;
  path: string;
  fsPath: string;
  toString(): string;
};

function makeUri(value: string): StubUri {
  const normalized = normalizeUriString(value);
  const schemeEnd = normalized.indexOf("://");
  const scheme = schemeEnd === -1 ? "file" : normalized.slice(0, schemeEnd);
  const path = schemeEnd === -1 ? normalized : normalized.slice(schemeEnd + 2);
  return {
    scheme,
    path,
    fsPath: path,
    toString: () => normalized,
  };
}

export const Uri = {
  parse: (value: string): StubUri => makeUri(value),
  file: (path: string): StubUri => makeUri(`file://${path}`),
  joinPath: (base: StubUri, ...segments: string[]): StubUri =>
    makeUri([base.toString(), ...segments].join("/")),
};

// ------------------------------------------------------------------- documents

type StubTextDocument = { uri: StubUri; getText(): string };

const textDocuments: StubTextDocument[] = [];

/** Replace the set of open editor documents (used for unsaved buffers). */
export function __setTextDocuments(docs: Record<string, string> = {}) {
  textDocuments.length = 0;
  for (const [uri, text] of Object.entries(docs)) {
    textDocuments.push({ uri: makeUri(uri), getText: () => text });
  }
}

// ------------------------------------------------------------------- workspace

export const workspace = {
  fs: {
    stat: async (uri: StubUri) => {
      const entry = fileSystem.get(uri.toString());
      if (entry === undefined) {
        throw new Error(`ENOENT: ${uri.toString()}`);
      }
      return typeof entry === "string"
        ? { type: FileType.File, size: entry.length }
        : { type: FileType.Directory, size: 0 };
    },
    readFile: async (uri: StubUri) => {
      const entry = fileSystem.get(uri.toString());
      if (typeof entry !== "string") {
        throw new Error(`ENOENT: ${uri.toString()}`);
      }
      return new TextEncoder().encode(entry);
    },
    readDirectory: async (_uri: StubUri): Promise<[string, FileType][]> => [],
  },
  get textDocuments() {
    return textDocuments;
  },
  getConfiguration: (_section?: string) => ({
    get: (key: string) => configurationStore[key],
    update: async (key: string, value: any, _target?: ConfigurationTarget) => {
      if (configurationUpdateError) {
        throw configurationUpdateError;
      }
      configurationStore[key] = value;
    },
  }),
  getWorkspaceFolder: (_uri: StubUri) => undefined,
  workspaceFolders: undefined as { uri: StubUri }[] | undefined,
};

/** Set the workspace folders `getGitDir` and friends resolve against. */
export function __setWorkspaceFolders(uris: string[]) {
  workspace.workspaceFolders = uris.length
    ? uris.map((uri) => ({ uri: makeUri(uri) }))
    : undefined;
}

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

/** An OutputChannel that records what was written to it. */
export function __outputChannel(): any & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine: (line: string) => lines.push(line),
    append: (value: string) => lines.push(value),
    show: () => undefined,
    dispose: () => undefined,
  };
}
