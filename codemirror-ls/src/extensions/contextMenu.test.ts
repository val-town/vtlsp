import { EditorView } from "@codemirror/view";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { LSClient } from "../LSClient";
import { LSPlugin } from "../LSPlugin";
import { LSMockTransport } from "../transport/LSMockTransport.js";
import {
  type ContextMenuRenderer,
  contextMenuActivated,
  getContextMenuExtensions,
} from "./contextMenu";

describe("contextMenu", () => {
  let renderer: MockedFunction<ContextMenuRenderer>;
  let mockTransport: LSMockTransport;
  let view: EditorView;

  beforeEach(() => {
    renderer = vi.fn();
    mockTransport = new LSMockTransport({
      definitionProvider: true,
      referencesProvider: true,
    });

    view = new EditorView({
      doc: "Test document",
      extensions: [
        LSPlugin.of({
          documentUri: "file:///test.txt",
          languageId: "plaintext",
          client: new LSClient({
            transport: mockTransport,
            workspaceFolders: null,
          }),
        }),
        getContextMenuExtensions({
          render: renderer,
          disableFindAllReferences: true,
        }),
      ],
    });
  });

  it("renders on annotation event", () => {
    view.dispatch({
      annotations: [
        contextMenuActivated.of({
          event: new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }),
          pos: 5,
        }),
      ],
    });

    expect(renderer).toHaveBeenCalled();
    const callbacks = renderer.mock.calls[0][1];

    expect(callbacks.goToDefinition).not.toBe(null);
    expect(callbacks.goToTypeDefinition).toBeNull();
    expect(callbacks.goToImplementation).toBeNull();
    expect(callbacks.findAllReferences).toBeNull();
    expect(callbacks.rename).toBeNull();
  });
});
