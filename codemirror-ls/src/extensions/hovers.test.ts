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
import { LSMockTransport } from "../transport/LSMockTransport";
import { getHoversExtensions, type HoversRenderer } from "./hovers";

describe("hovers", () => {
  let renderer: MockedFunction<HoversRenderer>;
  let mockTransport: LSMockTransport;
  let view: EditorView;
  let dom: HTMLDivElement;

  beforeEach(() => {
    renderer = vi.fn();
    mockTransport = new LSMockTransport({
      definitionProvider: true,
      referencesProvider: true,
    });

    dom = document.createElement("div");
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
        getHoversExtensions({
          render: renderer,
          hoverTime: 0,
          hideOnChange: true,
        }),
      ],
      parent: dom,
    });
  });

  it("renders on hover event", async () => {
    dom.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 1_000));
    expect(renderer).toHaveBeenCalled();
  });
});
