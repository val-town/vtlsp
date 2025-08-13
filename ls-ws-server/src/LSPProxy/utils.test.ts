// deno-lint-ignore-file no-explicit-any

import { describe, expect, it } from "vitest";
import { replaceFileUris } from "./utils.ts";

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
