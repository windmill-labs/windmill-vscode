// Inline the sanitization logic to avoid importing vscode-dependent file-utils
// eslint-disable-next-line no-control-regex
const sanitizePathSegment = (name: string) => name.replace(/[\x00-\x1f\\/:<>"|?*]/g, "");

describe("sanitizePathSegment", () => {
  it("should pass through normal names unchanged", () => {
    expect(sanitizePathSegment("my_step")).toBe("my_step");
    expect(sanitizePathSegment("step1")).toBe("step1");
    expect(sanitizePathSegment("hello world")).toBe("hello world");
  });

  it("should remove forward slashes", () => {
    expect(sanitizePathSegment("../../etc/passwd")).toBe("....etcpasswd");
    expect(sanitizePathSegment("a/b/c")).toBe("abc");
  });

  it("should remove backslashes", () => {
    expect(sanitizePathSegment("..\\..\\windows\\system32")).toBe("....windowssystem32");
    expect(sanitizePathSegment("a\\b")).toBe("ab");
  });

  it("should remove OS-reserved characters", () => {
    expect(sanitizePathSegment('step<1>:2|3"4?5*6')).toBe("step123456");
  });

  it("should remove control characters", () => {
    expect(sanitizePathSegment("step\x00name")).toBe("stepname");
    expect(sanitizePathSegment("step\x1fname")).toBe("stepname");
    expect(sanitizePathSegment("step\tname")).toBe("stepname");
    expect(sanitizePathSegment("step\nname")).toBe("stepname");
  });

  it("should handle empty string", () => {
    expect(sanitizePathSegment("")).toBe("");
  });

  it("should handle string of only bad characters", () => {
    expect(sanitizePathSegment("/\\:*?")).toBe("");
  });
});
