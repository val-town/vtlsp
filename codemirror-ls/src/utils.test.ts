import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isInCurrentDocumentBounds } from "./utils.js";
import { describe, it, expect } from "vitest";

describe("isInCurrentDocumentBounds", () => {
  it("should return true for a range within the document", () => {
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
    };
    const view = new EditorView({
      state: EditorState.create({
        doc: "Hello\nWorld",
      }),
    });
    expect(isInCurrentDocumentBounds(range, view)).toBe(true);
  });

  it("should return false for a range outside the document", () => {
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 2, character: 0 },
    };
    const view = new EditorView({
      state: EditorState.create({
        doc: "Hello\nWorld",
      }),
    });
    expect(isInCurrentDocumentBounds(range, view)).toBe(false);
  });
});
