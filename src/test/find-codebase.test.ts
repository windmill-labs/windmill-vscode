import { findCodebase } from "../config/config-manager";

describe("findCodebase", () => {
  it("matches a codebase without includes", () => {
    const codebase = {};
    expect(findCodebase("f/foo/bar.ts", [codebase])).toBe(codebase);
  });

  it("matches on an includes glob", () => {
    const codebase = { includes: ["f/foo/**"] };
    expect(findCodebase("f/foo/bar.ts", [codebase])).toBe(codebase);
    expect(findCodebase("f/other/bar.ts", [codebase])).toBeUndefined();
  });

  it("accepts includes and excludes given as a bare string", () => {
    expect(findCodebase("f/foo/bar.ts", [{ includes: "f/foo/**" }])).toBeDefined();
    expect(
      findCodebase("f/foo/bar.ts", [{ includes: "f/foo/**", excludes: "**/bar.ts" }])
    ).toBeUndefined();
  });

  it("stops at the first matching includes glob", () => {
    const codebase = { includes: ["f/foo/**", "f/other/**"] };
    expect(findCodebase("f/foo/bar.ts", [codebase])).toBe(codebase);
  });

  it("rejects an excluded path", () => {
    const codebase = { includes: ["f/foo/**"], excludes: ["f/foo/skip/**"] };
    expect(findCodebase("f/foo/keep/x.ts", [codebase])).toBe(codebase);
    expect(findCodebase("f/foo/skip/x.ts", [codebase])).toBeUndefined();
  });

  it("keeps looking past a codebase that does not match", () => {
    // The CLI's findCodebase scans every codebase; stopping at the first one
    // made any codebase after it unreachable.
    const first = { includes: ["f/first/**"] };
    const second = { includes: ["f/second/**"] };

    expect(findCodebase("f/second/bar.ts", [first, second])).toBe(second);
  });

  it("returns the first of several matching codebases", () => {
    const first = { includes: ["f/**"] };
    const second = { includes: ["f/foo/**"] };

    expect(findCodebase("f/foo/bar.ts", [first, second])).toBe(first);
  });

  it("returns undefined when there are no codebases", () => {
    expect(findCodebase("f/foo/bar.ts", [])).toBeUndefined();
  });
});
