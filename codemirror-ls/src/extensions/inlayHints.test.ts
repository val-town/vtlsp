import { EditorView } from "@codemirror/view";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import type * as LSP from "vscode-languageserver-protocol";
import { LSClient } from "../LSClient";
import { LSPlugin } from "../LSPlugin";
import { LSMockTransport } from "../transport/LSMockTransport";
import { getInlayHintExtensions, type InlayHintsRenderer } from "./inlayHints";

describe("inlayHints", () => {
  let renderer: MockedFunction<InlayHintsRenderer>;
  let mockTransport: LSMockTransport;

  beforeEach(() => {
    renderer = vi.fn();
    mockTransport = new LSMockTransport({
      inlayHintProvider: true,
    });

    new EditorView({
      doc: "function test(param: string) { return param; }",
      extensions: [
        LSPlugin.of({
          documentUri: "file:///test.ts",
          languageId: "typescript",
          client: new LSClient({
            transport: mockTransport,
            workspaceFolders: null,
          }),
        }),
        getInlayHintExtensions({
          render: renderer,
          debounceTime: 1000,
          clearOnEdit: false,
        }),
      ],
    });
  });

  it("requests inlay hints and renders them", async () => {
    const mockInlayHints: LSP.InlayHint[] = [
      {
        position: { line: 0, character: 14 },
        label: ": string",
        kind: 1, // Type hint
      },
    ];

    mockTransport.sendRequest.mockResolvedValueOnce(mockInlayHints);

    await new Promise((r) => setTimeout(r, 500));

    expect(renderer).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 500));

    expect(mockTransport.sendRequest).toHaveBeenCalledWith(
      "textDocument/inlayHint",
      expect.objectContaining({
        textDocument: { uri: "file:///test.ts" },
        range: expect.any(Object),
      }),
    );
  });
});
