/** biome-ignore-all lint/suspicious/noExplicitAny: useful for tests */

import { describe, expect, it } from "vitest";
import {
  replaceFileUris,
  tempDirUriToVirtualUri,
  virtualUriToTempDirUri,
} from "./utils.ts";

describe("replaceFileUris", () => {
  const uriConverter = (uri: string) => `converted:${uri}`;

  it("should replace URIs in simple objects", () => {
    const simpleObj = { uri: "file:///path/to/file.ts" };
    const convertedSimple = replaceFileUris(simpleObj, uriConverter) as any;

    expect(convertedSimple.uri).toBe("converted:file:///path/to/file.ts");
    expect(simpleObj.uri).toBe("file:///path/to/file.ts"); // Original object should not be modified
  });

  it("should replace URIs in nested objects", () => {
    const nestedObj = {
      name: "test",
      resource: {
        uri: "file:///path/to/resource.ts",
        specifier: "file:///specifier.ts",
      },
    };
    const convertedNested = replaceFileUris(nestedObj, uriConverter) as any;

    expect(convertedNested.resource.uri).toBe(
      "converted:file:///path/to/resource.ts",
    );
    expect(convertedNested.resource.specifier).toBe(
      "converted:file:///specifier.ts",
    );
  });

  it("should replace URIs in arrays", () => {
    const arrayObj = {
      files: [
        { uri: "file:///file1.ts" },
        { uri: "file:///file2.ts", name: "file2" },
        { specifier: "file:///file3.ts" },
      ],
    };
    const convertedArray = replaceFileUris(arrayObj, uriConverter) as any;

    expect(convertedArray.files[0].uri).toBe("converted:file:///file1.ts");
    expect(convertedArray.files[1].uri).toBe("converted:file:///file2.ts");
    expect(convertedArray.files[2].specifier).toBe(
      "converted:file:///file3.ts",
    );
  });

  it("should not replace URIs in non-URI keys", () => {
    const obj = {
      description: "This is a file:///path/description.txt in a description",
      title: "Contains file:///example.js in title",
      content: "Some file:///content.md reference",
    };
    const converted = replaceFileUris(obj, uriConverter) as any;

    expect(converted.description).toBe(
      "This is a converted:file:///path/description.txt in a description",
    );
    expect(converted.title).toBe(
      "Contains converted:file:///example.js in title",
    );
    expect(converted.content).toBe(
      "Some converted:file:///content.md reference",
    );
  });

  it("should handle mixed content with file URIs and other text", () => {
    const obj = {
      message: "Error in file:///src/main.ts at line 42",
      uri: "file:///workspace/project.json",
      description:
        "Processing file:///data/input.csv and file:///config/settings.json",
      nonUriField: "This file:///path/should/be/converted.ts anyway",
    };
    const converted = replaceFileUris(obj, uriConverter) as any;

    expect(converted.message).toBe(
      "Error in converted:file:///src/main.ts at line 42",
    );
    expect(converted.uri).toBe("converted:file:///workspace/project.json");
    expect(converted.description).toBe(
      "Processing converted:file:///data/input.csv and converted:file:///config/settings.json",
    );
    expect(converted.nonUriField).toBe(
      "This converted:file:///path/should/be/converted.ts anyway",
    );
  });

  it("should handle primitive values", () => {
    expect(replaceFileUris("file:///test.ts", uriConverter)).toBe(
      "converted:file:///test.ts",
    );
    expect(replaceFileUris(42, uriConverter)).toBe(42);
    expect(replaceFileUris(true, uriConverter)).toBe(true);
    expect(replaceFileUris(null, uriConverter)).toBe(null);
    expect(replaceFileUris(undefined, uriConverter)).toBe(undefined);
  });

  it("should handle empty objects and arrays", () => {
    expect(replaceFileUris({}, uriConverter)).toEqual({});
    expect(replaceFileUris([], uriConverter)).toEqual([]);
  });

  it("should handle complex nested structures", () => {
    const complexObj = {
      project: {
        name: "Test Project",
        files: [
          { uri: "file:///src/index.ts" },
          { uri: "file:///src/utils.ts" },
        ],
        config: {
          mainFile: "file:///src/index.ts",
          dependencies: [
            "file:///node_modules/dependency1",
            "file:///node_modules/dependency2",
          ],
        },
      },
    };
    const convertedComplex = replaceFileUris(complexObj, uriConverter) as any;

    expect(convertedComplex.project.files[0].uri).toBe(
      "converted:file:///src/index.ts",
    );
    expect(convertedComplex.project.files[1].uri).toBe(
      "converted:file:///src/utils.ts",
    );
    expect(convertedComplex.project.config.mainFile).toBe(
      "converted:file:///src/index.ts",
    );
    expect(convertedComplex.project.config.dependencies[0]).toBe(
      "converted:file:///node_modules/dependency1",
    );
    expect(convertedComplex.project.config.dependencies[1]).toBe(
      "converted:file:///node_modules/dependency2",
    );
  });
});

describe("virtualUriToTempDirUri containment (C1 regression)", () => {
  const TEMP = "/tmp/vtlsp-proxy-abc";
  const pathnameOf = (uri: string) => new URL(uri).pathname;
  const inside = (uri: string) =>
    pathnameOf(uri).startsWith(`${TEMP}/`) || pathnameOf(uri) === TEMP;

  it("keeps mapping legitimate virtual file URIs into the temp dir (regression guard)", () => {
    expect(virtualUriToTempDirUri("foobar.tsx", TEMP)).toBe(
      "file:///tmp/vtlsp-proxy-abc/foobar.tsx",
    );
    expect(virtualUriToTempDirUri("/foobar.tsx", TEMP)).toBe(
      "file:///tmp/vtlsp-proxy-abc/foobar.tsx",
    );
    expect(virtualUriToTempDirUri("file:///Users/tmcw/x/foo.ts", TEMP)).toBe(
      "file:///tmp/vtlsp-proxy-abc/Users/tmcw/x/foo.ts",
    );
  });

  it("returns an already-temp file URI unchanged (canonical path)", () => {
    const result = virtualUriToTempDirUri(
      "file:///tmp/vtlsp-proxy-abc/foo.ts",
      TEMP,
    );
    expect(result).toBe("file:///tmp/vtlsp-proxy-abc/foo.ts");
    const raw = virtualUriToTempDirUri("/tmp/vtlsp-proxy-abc/foo.ts", TEMP);
    expect(raw).toBe("file:///tmp/vtlsp-proxy-abc/foo.ts");
  });

  it("rejects non-file URI schemes (was: passthrough -> arbitrary write)", () => {
    expect(virtualUriToTempDirUri("http://example.com/foobar.tsx", TEMP)).toBe(
      undefined,
    );
    expect(virtualUriToTempDirUri("http://x/../../etc/passwd", TEMP)).toBe(
      undefined,
    );
    expect(virtualUriToTempDirUri("untitled:Untitled-1", TEMP)).toBe(undefined);
  });

  it("neutralizes .. traversal escapes (result never escapes tempDir)", () => {
    // `..` / encoded-dot segments are canonicalized away before any URI is
    // returned; a returned URI must always stay inside the temp dir. (Pure
    // anchor escapes are additionally rejected outright below.)
    const cases = [
      "file:///tmp/vtlsp-proxy-abc/../etc/passwd",
      "file:///tmp/vtlsp-proxy-abc/%2e%2e/etc/passwd",
      "file:///tmp/vtlsp-proxy-abc/%2e./etc/passwd",
      "file:///tmp/vtlsp-proxy-abc/x/../../y.ts",
    ];
    for (const c of cases) {
      const result = virtualUriToTempDirUri(c, TEMP);
      if (result) expect(inside(result)).toBe(true);
    }
    // Anchor escapes that would climb out of the joined tree are rejected.
    expect(virtualUriToTempDirUri("/../../etc/passwd", TEMP)).toBe(undefined);
    expect(virtualUriToTempDirUri("file:///../../etc/passwd", TEMP)).toBe(
      undefined,
    );
  });

  it("rejects prefix-sibling directories (was: startsWith fast-path bypass)", () => {
    const result = virtualUriToTempDirUri(
      "file:///tmp/vtlsp-proxy-abc-evil/foo.ts",
      TEMP,
    );
    // Must not map to /tmp/vtlsp-proxy-abc-evil/foo.ts outside the temp dir.
    expect(result ? pathnameOf(result) : undefined).not.toBe(
      "/tmp/vtlsp-proxy-abc-evil/foo.ts",
    );
    if (result) expect(inside(result)).toBe(true);
  });

  it("rejects Windows-style / encoded escapes and keeps single-dot inside after canonicalization", () => {
    // single %2e collapses in the canonical parent dir (contained, not a traversal)
    const singleDot = virtualUriToTempDirUri(
      "file:///tmp/vtlsp-proxy-abc/%2e/etc/passwd",
      TEMP,
    );
    expect(singleDot).toBeTruthy();
    expect(inside(singleDot!)).toBe(true);
  });

  it("never returns a temp URI whose pathname escapes the temp dir", () => {
    const cases = [
      "file:///Users/x/a.ts",
      "file:///tmp/vtlsp-proxy-abc/deep/nested.ts",
      "file:///tmp/vtlsp-proxy-abc/../x.ts",
      "file:///tmp/vtlsp-proxy-abc/x/../../y.ts",
      "file:///tmp/vtlsp-proxy-abc-evil/x.ts",
      "/a/b/c.ts",
      "deep/../../escape.ts",
    ];
    for (const c of cases) {
      const result = virtualUriToTempDirUri(c, TEMP);
      if (result) expect(inside(result)).toBe(true);
    }
  });
});

describe("tempDirUriToVirtualUri inverse mapping (boundary-correct)", () => {
  const TEMP = "/tmp/vtlsp-proxy-abc";

  it("strips the temp prefix for contained paths", () => {
    expect(
      tempDirUriToVirtualUri("file:///tmp/vtlsp-proxy-abc/foo.ts", TEMP),
    ).toBe("file:///foo.ts");
  });

  it("does not strip the prefix for sibling directories (was: mis-mapped)", () => {
    expect(
      tempDirUriToVirtualUri("file:///tmp/vtlsp-proxy-abc-evil/foo.ts", TEMP),
    ).toBe("file:///tmp/vtlsp-proxy-abc-evil/foo.ts");
  });

  it("passes non-file URIs through", () => {
    expect(tempDirUriToVirtualUri("http://example.com/x.ts", TEMP)).toBe(
      "http://example.com/x.ts",
    );
  });
});
