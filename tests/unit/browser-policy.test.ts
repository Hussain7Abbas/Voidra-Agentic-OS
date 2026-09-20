import { describe, expect, it } from "vitest";
import { BROWSER_START_URL, containsPath, decodeArtifactPath, normalizeBrowserUrl } from "../../src/domain/browser-policy";

describe("browser and artifact boundary policy", () => {
  it("accepts web addresses and reserves the built-in data URL", () => {
    expect(normalizeBrowserUrl("example.com/path")).toBe("https://example.com/path");
    expect(normalizeBrowserUrl("http://127.0.0.1:3000/test")).toBe("http://127.0.0.1:3000/test");
    expect(normalizeBrowserUrl("local first assistants")).toBe("https://duckduckgo.com/?q=local%20first%20assistants");
    expect(normalizeBrowserUrl("")).toBe(BROWSER_START_URL);
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeBrowserUrl("data:text/html,hostile")).toThrow("reserved");
  });

  it("rejects decoded traversal and Windows-style traversal", () => {
    expect(decodeArtifactPath("/assets/app.js")).toBe("assets/app.js");
    expect(() => decodeArtifactPath("/%2e%2e/secret.txt")).toThrow("escapes");
    expect(() => decodeArtifactPath("/assets/%2E%2E/secret.txt")).toThrow("escapes");
    expect(() => decodeArtifactPath("/assets%5C..%5Csecret.txt")).toThrow("escapes");
    expect(() => decodeArtifactPath("/%ZZ")).toThrow("encoding");
  });

  it("uses path segments instead of string prefixes for containment", () => {
    expect(containsPath("/work/artifact", "/work/artifact/assets/a.css")).toBe(true);
    expect(containsPath("/work/artifact", "/work/artifact-other/secret")).toBe(false);
    expect(containsPath("/work/artifact", "/work/secret")).toBe(false);
  });
});
