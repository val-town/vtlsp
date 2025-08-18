import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LSClient } from "./LSClient.js";
import { LSCore } from "./LSPlugin.js";
import { LSMockTransport } from "./transport/LSMockTransport.js";

describe("LSPlugin", () => {
  let mockTransport: LSMockTransport;
  let client: LSClient;
  let view: EditorView;
  let lsCore: LSCore;

  beforeEach(() => {
    mockTransport = new LSMockTransport();
    client = new LSClient({ transport: mockTransport, workspaceFolders: null });

    view = new EditorView({
      state: EditorState.create({
        doc: "initial document content",
      }),
      parent: document.body,
    });

    lsCore = new LSCore(view, {
      client,
      documentUri: "file:///test.ts",
      languageId: "typescript",
    });
  });

  it("should execute doWithLock and provide current document", async () => {
    const mockCallback = vi.fn((doc) => {
      expect(doc.toString()).toBe("initial document content");
      return "callback result";
    });

    const result = await lsCore.doWithLock(mockCallback);

    expect(result).toBe("callback result");
    expect(mockCallback).toHaveBeenCalledOnce();
  });

  it("should timeout doWithLock after specified duration", async () => {
    const slowCallback = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "should not complete";
    });

    await expect(lsCore.doWithLock(slowCallback, 50)).rejects.toThrow(
      "Lock timed out",
    );
  });

  it("should prevent changes from being sent during doWithLock", async () => {
    let lockActive = false;
    let changesSentDuringLock = false;

    mockTransport.sendNotification.mockImplementation((method) => {
      if (method === "textDocument/didChange" && lockActive) {
        changesSentDuringLock = true;
      }
    });

    const mockCallback = vi.fn(async () => {
      lockActive = true;

      // Make changes during the lock
      view.dispatch({
        changes: { from: 0, to: 0, insert: "changed during lock" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      lockActive = false;
      return "callback result";
    });

    const result = await lsCore.doWithLock(mockCallback);

    expect(result).toBe("callback result");
    expect(changesSentDuringLock).toBe(false);

    expect(mockTransport.sendNotification).toHaveBeenCalledWith(
      "textDocument/didChange",
      expect.anything(),
    );
  });
});
