import * as helpers from '../helpers';

describe('getRootPathFromRunnablePath', () => {
  const root = '/root';
  it('should return root path when fullPath includes "/u/"', () => {
    const fullPath = '/root/u/runnable';
    expect(helpers.getRootPathFromRunnablePath(fullPath)).toBe(root);
  });

  it('should return root path when fullPath includes "/f/"', () => {
    const fullPath = '/root/f/runnable';
    expect(helpers.getRootPathFromRunnablePath(fullPath)).toBe(root);
  });

  it('should return root path when fullPath ends with "/u/"', () => {
    const fullPath = '/root/u/';
    expect(helpers.getRootPathFromRunnablePath(fullPath)).toBe(root);
  });

  it('should return root path when fullPath ends with "/f/"', () => {
    const fullPath = '/root/f/';
    expect(helpers.getRootPathFromRunnablePath(fullPath)).toBe(root);
  });

  it('should return undefined when fullPath does not include or end with "/u/" or "/f/"', () => {
    const fullPath = '/root/runnable';
    expect(helpers.getRootPathFromRunnablePath(fullPath)).toBeUndefined();
  });
});


describe('determineLanguage', () => {
  it('should return "python3" when extension is "py"', () => {
    const path = 'path/to/file.py';
    const expected = 'python3';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return "go" when extension is "go"', () => {
    const path = 'path/to/file.go';
    const expected = 'go';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return "bash" when extension is "sh"', () => {
    const path = 'path/to/file.sh';
    const expected = 'bash';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return "graphql" when extension is "gql"', () => {
    const path = 'path/to/file.gql';
    const expected = 'graphql';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return "powershell" when extension is "ps1"', () => {
    const path = 'path/to/file.ps1';
    const expected = 'powershell';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return "flow" when extension is "yaml" and penu is "flow/flow"', () => {
    const path = 'path/to/x.flow/flow.yaml';
    const expected = 'flow';
    expect(helpers.determineLanguage(path)).toBe(expected);
  });

  it('should return undefined when extension is "yaml" and penu is not "flow/flow"', () => {
    const path = 'path/to/file.yaml';
    expect(helpers.determineLanguage(path)).toBeUndefined();
  });

  it('should return undefined when extension is not recognized', () => {
    const path = 'path/to/file.unknown';
    expect(helpers.determineLanguage(path)).toBeUndefined();
  });

  // Tests below for getTypescriptType and getSqlType should cover our bases for the rest of the cases
});

describe('getTypescriptType', () => {
  it('should return "nativets" when len is greater than 2 and penu is "fetch"', () => {
    const len = 3;
    const penu = 'fetch';
    const expected = 'nativets';
    expect(helpers.getTypescriptType(len, penu)).toBe(expected);
  });

  it('should return "bun" when len is greater than 2 and penu is "bun"', () => {
    const len = 3;
    const penu = 'bun';
    const expected = 'bun';
    expect(helpers.getTypescriptType(len, penu)).toBe(expected);
  });

  it('should return "deno" when len is not greater than 2', () => {
    const len = 2;
    const penu = 'fetch';
    const expected = 'deno';
    expect(helpers.getTypescriptType(len, penu)).toBe(expected);
  });

  it('should return "deno" when len is greater than 2 and penu is not "fetch" or "bun"', () => {
    const len = 3;
    const penu = 'other';
    const expected = 'deno';
    expect(helpers.getTypescriptType(len, penu)).toBe(expected);
  });
});


describe('getSqlType', () => {
  it('should return "mysql" when len is greater than 2 and penu is "my"', () => {
    const len = 3;
    const penu = 'my';
    const expected = 'mysql';
    expect(helpers.getSqlType(len, penu)).toBe(expected);
  });

  it('should return "bigquery" when len is greater than 2 and penu is "bq"', () => {
    const len = 3;
    const penu = 'bq';
    const expected = 'bigquery';
    expect(helpers.getSqlType(len, penu)).toBe(expected);
  });

  it('should return "snowflake" when len is greater than 2 and penu is "sf"', () => {
    const len = 3;
    const penu = 'sf';
    const expected = 'snowflake';
    expect(helpers.getSqlType(len, penu)).toBe(expected);
  });

  it('should return "postgresql" when len is not greater than 2', () => {
    const len = 2;
    const penu = 'my';
    const expected = 'postgresql';
    expect(helpers.getSqlType(len, penu)).toBe(expected);
  });

  it('should return "postgresql" when len is greater than 2 and penu is not "my", "bq", or "sf"', () => {
    const len = 3;
    const penu = 'other';
    const expected = 'postgresql';
    expect(helpers.getSqlType(len, penu)).toBe(expected);
  });
});
