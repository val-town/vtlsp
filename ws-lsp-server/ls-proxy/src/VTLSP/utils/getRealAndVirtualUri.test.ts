import { expect } from "@std/expect";
import { getRealUri, getVirtualUri } from "./getRealAndVirtualUri.ts";
import { describe, it } from "@std/testing/bdd";

const TEMP_DIR = "/tmp/test-temp-dir";

describe("getRealUri", () => {
  it("should convert virtual file URIs to real temp URIs", () => {
    expect(getRealUri("file:///foobar.tsx", TEMP_DIR)).toBe(
      "file:///tmp/test-temp-dir/foobar.tsx"
    );
  });

  it("should convert relative paths to real temp URIs", () => {
    expect(getRealUri("foobar.tsx", TEMP_DIR)).toBe(
      "file:///tmp/test-temp-dir/foobar.tsx"
    );
  });

  it("should convert absolute virtual paths to real temp URIs", () => {
    expect(getRealUri("/foobar.tsx", TEMP_DIR)).toBe(
      "file:///tmp/test-temp-dir/foobar.tsx"
    );
  });

  it("should return existing temp URIs unchanged", () => {
    const tempUri = "file:///tmp/test-temp-dir/foobar.tsx";
    expect(getRealUri(tempUri, TEMP_DIR)).toBe(tempUri);
  });

  it("should return existing temp paths as URIs", () => {
    expect(getRealUri("/tmp/test-temp-dir/foobar.tsx", TEMP_DIR)).toBe(
      "file:///tmp/test-temp-dir/foobar.tsx"
    );
  });

  it("should return non-file URIs unchanged", () => {
    const httpUri = "http://example.com/foobar.tsx";
    expect(getRealUri(httpUri, TEMP_DIR)).toBe(httpUri);

    const httpsUri = "https://example.com/foobar.tsx";
    expect(getRealUri(httpsUri, TEMP_DIR)).toBe(httpsUri);

    const jsrUri = "jsr:@std/testing";
    expect(getRealUri(jsrUri, TEMP_DIR)).toBe(jsrUri);
  });
});

describe("getVirtualUri", () => {
  it("should convert temp file URIs to virtual URIs", () => {
    expect(getVirtualUri("file:///tmp/test-temp-dir/foobar.tsx", TEMP_DIR)).toBe(
      "file:///foobar.tsx"
    );
  });

  it("should convert temp paths to virtual URIs", () => {
    expect(getVirtualUri("/tmp/test-temp-dir/foobar.tsx", TEMP_DIR)).toBe(
      "file:///foobar.tsx"
    );
  });

  it("should handle root temp directory", () => {
    expect(getVirtualUri("file:///tmp/test-temp-dir", TEMP_DIR)).toBe(
      "file:///"
    );
    expect(getVirtualUri("/tmp/test-temp-dir", TEMP_DIR)).toBe(
      "file:///"
    );
  });

  it("should return non-temp paths as file URIs", () => {
    expect(getVirtualUri("/some/other/path.tsx", TEMP_DIR)).toBe(
      "file:///some/other/path.tsx"
    );
    expect(getVirtualUri("relative.tsx", TEMP_DIR)).toBe(
      "file:///relative.tsx"
    );
  });

  it("should return non-file URIs unchanged", () => {
    const httpUri = "http://example.com/foobar.tsx";
    expect(getVirtualUri(httpUri, TEMP_DIR)).toBe(httpUri);

    const httpsUri = "https://example.com/foobar.tsx";
    expect(getVirtualUri(httpsUri, TEMP_DIR)).toBe(httpsUri);

    const jsrUri = "jsr:@std/testing";
    expect(getVirtualUri(jsrUri, TEMP_DIR)).toBe(jsrUri);
  });

  it("should handle nested paths correctly", () => {
    expect(getVirtualUri("file:///tmp/test-temp-dir/nested/deep/file.tsx", TEMP_DIR)).toBe(
      "file:///nested/deep/file.tsx"
    );
  });
});

describe("getRealUri and getVirtualUri integration", () => {
  it("should maintain round trip consistency", () => {
    const testCases = [
      "foobar.tsx",
      "/foobar.tsx",
      "nested/file.tsx",
      "/nested/file.tsx",
      "file:///foobar.tsx",
      "file:///nested/file.tsx",
    ];

    for (const input of testCases) {
      const real = getRealUri(input, TEMP_DIR)!;
      const virtual = getVirtualUri(real, TEMP_DIR);
      const realAgain = getRealUri(virtual, TEMP_DIR)!;

      expect(realAgain).toBe(real);
    }
  });
});