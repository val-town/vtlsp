import { describe, it, expect } from "vitest";
import { eventsFromChangeSet, prefixMatch } from "./utils";
import type * as LSP from "vscode-languageserver-protocol";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

function createItems(labels: string[]): LSP.CompletionItem[] {
  return labels.map((label) => ({ label }));
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createMockContext(text: string) {
  return new CompletionContext(
    EditorState.create({ doc: text }),
    text.length,
    false
  );
}

describe("prefixMatch", () => {
  it("should handle empty items array", () => {
    const pattern = prefixMatch([]);
    expect(pattern).toBeUndefined();
  });

  it("should handle no prefix", () => {
    const items = createItems(["foo", "bar"]);
    const pattern = prefixMatch(items);
    expect(pattern).toBeUndefined();
  });

  it("should match basic prefixes", () => {
    const items = createItems(["foo/", "foo.py", "foo.txt", "foo.md"]);
    const context = createMockContext("foo");
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(context.matchBefore(pattern)).toEqual({
      from: 0,
      to: 3,
      text: "foo",
    });
  });

  it("should when includes a slash", () => {
    const items = createItems(["foo/", "foo.py", "foo.txt", "foo.md"]);
    const context = createMockContext("path/to/foo");
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(context.matchBefore(pattern)).toEqual({
      from: 8,
      to: 11,
      text: "foo",
    });
  });

  it("should match when includes a dot", () => {
    const items = createItems(["foo.py", "foo.txt", "foo.md"]);
    const context = createMockContext("path/to/foo.");
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(context.matchBefore(pattern)).toEqual({
      from: 8,
      to: 12,
      text: "foo.",
    });
  });

  it("should match when contains multiple matches", () => {
    const items = createItems(["foo.py", "foo.txt", "foo.md"]);
    const context = createMockContext("foo/foo/foo");
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(context.matchBefore(pattern)).toEqual({
      from: 8,
      to: 11,
      text: "foo",
    });
  });

  it("should match when contains ends with a slash", () => {
    const items = createItems(["foo/", "foo.py", "foo.txt", "foo.md"]);
    const context = createMockContext("path/to/");
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(context.matchBefore(pattern)).toEqual(null);
  });

  it("should handle shared prefixes", () => {
    const items = createItems(["for", "function"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    const context = createMockContext("f");
    expect(context.matchBefore(pattern)).toEqual({
      from: 0,
      to: 1,
      text: "f",
    });
  });

  it("should handle shared prefixes with different match before", () => {
    const items = createItems(["for", "function"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    const context = createMockContext("for");
    expect(context.matchBefore(pattern)).toEqual(null);
  });

  it("should handle when common prefix is more than what was typed", () => {
    const items = createItems(["foobar", "foobaz"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("fo").matchBefore(pattern)).toEqual({
      from: 0,
      to: 2,
      text: "fo",
    });
    expect(createMockContext("f").matchBefore(pattern)).toEqual({
      from: 0,
      to: 1,
      text: "f",
    });
  });

  it("should handle mixed word and non-word characters", () => {
    const items = createItems(["user.name", "user.email"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("user").matchBefore(pattern)).toEqual({
      from: 0,
      to: 4,
      text: "user",
    });
    expect(createMockContext("user.").matchBefore(pattern)).toEqual({
      from: 0,
      to: 5,
      text: "user.",
    });
    expect(createMockContext("u").matchBefore(pattern)).toEqual({
      from: 0,
      to: 1,
      text: "u",
    });
    expect(createMockContext("foo/").matchBefore(pattern)).toEqual(null);
    expect(createMockContext("foo/us").matchBefore(pattern)).toEqual({
      from: 4,
      to: 6,
      text: "us",
    });
    expect(createMockContext("obj.property(").matchBefore(pattern)).toEqual(
      null
    );
    expect(createMockContext("obj.property(us").matchBefore(pattern)).toEqual({
      from: 13,
      to: 15,
      text: "us",
    });
  });

  it("should handle special characters", () => {
    const items = createItems(["$name", "$value"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("$").matchBefore(pattern)).toEqual({
      from: 0,
      to: 1,
      text: "$",
    });
    expect(createMockContext("$item.$").matchBefore(pattern)).toEqual({
      from: 6,
      to: 7,
      text: "$",
    });
    expect(createMockContext("$item.$name").matchBefore(pattern)).toEqual(null);
  });

  it("should handle empty items array", () => {
    const items: LSP.CompletionItem[] = [];
    const pattern = prefixMatch(items);
    expect(pattern).toBeUndefined();
  });

  it("should handle items with no common prefix", () => {
    const items = createItems(["apple", "banana", "cherry"]);
    const pattern = prefixMatch(items);
    expect(pattern).toBeUndefined();
  });

  it("should handle items with partial common prefix", () => {
    const items = createItems(["prefix_one", "prefix_two", "prefix_three"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("prefix_").matchBefore(pattern)).toEqual({
      from: 0,
      to: 7,
      text: "prefix_",
    });
    expect(createMockContext("pre").matchBefore(pattern)).toEqual({
      from: 0,
      to: 3,
      text: "pre",
    });
  });

  it("should handle regex special characters in prefixes", () => {
    const items = createItems(["user.*", "user.+", "user.?"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("user.").matchBefore(pattern)).toEqual({
      from: 0,
      to: 5,
      text: "user.",
    });
    expect(createMockContext("user.*").matchBefore(pattern)).toEqual(null);
  });

  it("should match at different positions in text", () => {
    const items = createItems(["test"]);
    const pattern = prefixMatch(items);
    invariant(pattern !== undefined, "pattern should not be undefined");
    expect(createMockContext("some test").matchBefore(pattern)).toEqual({
      from: 5,
      to: 9,
      text: "test",
    });
    expect(createMockContext("function(te").matchBefore(pattern)).toEqual({
      from: 9,
      to: 11,
      text: "te",
    });
    expect(createMockContext("obj.function(").matchBefore(pattern)).toEqual(
      null
    );
  });
});

describe("eventsFromChangeSet", () => {
  it("should handle a single insertion", () => {
    const doc = Text.of(["const a = 'b';", "console.log(a)"]);
    const changes = ChangeSet.of(
      { from: 0, insert: 'const c = "d"' },
      doc.length
    );

    const events = eventsFromChangeSet(doc, changes);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      text: 'const c = "d"',
    });
  });

  it("should handle a replacement", () => {
    const doc = Text.of(["const a = 'b';", "console.log(a)"]);
    const changes = ChangeSet.of({ from: 6, to: 7, insert: "xyz" }, doc.length);

    const events = eventsFromChangeSet(doc, changes);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
      text: "xyz",
    });
  });

  it("should handle a deletion", () => {
    const doc = Text.of(["const a = 'b';", "console.log(a)"]);
    const changes = ChangeSet.of({ from: 8, to: 11 }, doc.length);

    const events = eventsFromChangeSet(doc, changes);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 11 },
      },
      text: "",
    });
  });

  it("should handle multiple changes", () => {
    const doc = Text.of(["const a = 'b';", "console.log(a)"]);
    const changes = ChangeSet.of(
      [
        { from: 0, insert: 'const c = "d"\n' },
        { from: 11, to: 14, insert: "c" },
        { from: 16, to: 24 },
      ],
      doc.length
    );

    const events = eventsFromChangeSet(doc, changes);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 9 },
      },
      text: "",
    });
    expect(events[1]).toEqual({
      range: {
        start: { line: 0, character: 11 },
        end: { line: 0, character: 14 },
      },
      text: "c",
    });
    expect(events[2]).toEqual({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      text: 'const c = "d"\n',
    });
  });

  it("should handle a full document change", () => {
    const doc = Text.of(["const a = 'b';", "console.log(a)"]);
    const changes = ChangeSet.of(
      { from: 0, to: doc.length, insert: "new content" },
      doc.length
    );

    const events = eventsFromChangeSet(doc, changes);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      text: "new content",
    });
  });

  it("should handle changes across multiple lines", () => {
    const doc = Text.of(["line 1", "line 2", "line 3"]);
    const changes = ChangeSet.of(
      { from: 4, to: 12, insert: "modified" },
      doc.length
    );

    const events = eventsFromChangeSet(doc, changes);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      range: {
        start: { line: 0, character: 4 },
        end: { line: 1, character: 5 },
      },
      text: "modified",
    });
  });
});
