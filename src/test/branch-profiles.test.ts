import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getBranchProfileKey, getLastUsedProfile } from "../config/branch-profiles";

// The CLI writes this file under getStore(""), i.e. the config dir plus the hex
// of hash_string(""), which is 0. Verified against a real CLI-written file.
let configFolder: string;

function writeBranchProfiles(contents: string) {
  const dir = path.join(configFolder, "windmill", "0");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "branch-profiles.json"), contents, "utf8");
}

beforeEach(() => {
  configFolder = fs.mkdtempSync(path.join(os.tmpdir(), "wm-vscode-profiles-"));
});

afterEach(() => {
  fs.rmSync(configFolder, { recursive: true, force: true });
});

describe("getBranchProfileKey", () => {
  it("matches the key format the CLI writes", () => {
    // Shape taken from a real branch-profiles.json written by the CLI
    expect(getBranchProfileKey("test", "https://internal.windmill.dev/", "test")).toBe(
      "test|https://internal.windmill.dev/|test"
    );
  });

  it("normalizes the base URL the same way the CLI does", () => {
    // A wmill.yaml baseUrl without a trailing slash must hit the same entry
    expect(getBranchProfileKey("test", "https://internal.windmill.dev", "test")).toBe(
      "test|https://internal.windmill.dev/|test"
    );
  });

  it("falls back to the raw value for an unparseable URL", () => {
    expect(getBranchProfileKey("cm", "not a url", "cm")).toBe("cm|not a url|cm");
  });
});

describe("getLastUsedProfile", () => {
  const REMOTE = "https://windmill.example.net/";

  it("reads the profile the CLI remembered", async () => {
    writeBranchProfiles(
      JSON.stringify({ lastUsed: { [`cm|${REMOTE}|cm`]: "cm-service" } })
    );

    expect(await getLastUsedProfile("cm", REMOTE, "cm", configFolder)).toBe("cm-service");
  });

  it("finds the entry from a baseUrl without a trailing slash", async () => {
    writeBranchProfiles(
      JSON.stringify({ lastUsed: { [`cm|${REMOTE}|cm`]: "cm-service" } })
    );

    expect(
      await getLastUsedProfile("cm", "https://windmill.example.net", "cm", configFolder)
    ).toBe("cm-service");
  });

  it("returns undefined for a workspace with no remembered choice", async () => {
    writeBranchProfiles(JSON.stringify({ lastUsed: { [`ir|${REMOTE}|ir`]: "ir" } }));

    expect(await getLastUsedProfile("cm", REMOTE, "cm", configFolder)).toBeUndefined();
  });

  it("returns undefined when the file does not exist", async () => {
    expect(await getLastUsedProfile("cm", REMOTE, "cm", configFolder)).toBeUndefined();
  });

  it("returns undefined when the file is not valid JSON", async () => {
    writeBranchProfiles("{not json}");

    expect(await getLastUsedProfile("cm", REMOTE, "cm", configFolder)).toBeUndefined();
  });

  it("returns undefined when the file has no lastUsed map", async () => {
    writeBranchProfiles(JSON.stringify({}));

    expect(await getLastUsedProfile("cm", REMOTE, "cm", configFolder)).toBeUndefined();
  });
});
