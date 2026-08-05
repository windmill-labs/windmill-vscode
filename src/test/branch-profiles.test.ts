import { getBranchProfileKey } from "../config/branch-profiles";

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
