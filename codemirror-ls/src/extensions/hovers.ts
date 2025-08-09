import type { EditorView, Tooltip } from "@codemirror/view";
import { hoverTooltip } from "@codemirror/view";
import { offsetToPos, posToOffset, isEmptyDocumentation } from "../utils.js";
import type * as LSP from "vscode-languageserver-protocol";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { LSCore } from "../LSPlugin.js";

export type RenderHover = Renderer<
  [contents: string | LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]]
>;

export interface HoverExtensionArgs {
  render: RenderHover;
  hoverTime?: number;
}

export const getHoversExtensions: LSExtensionGetter<HoverExtensionArgs> = ({
  render,
  hoverTime,
}) => {
  return [
    hoverTooltip(
      async (view, pos, _side) => {
        const position = offsetToPos(view.state.doc, pos);
        return await requestHoverTooltip({
          view,
          line: position.line,
          character: position.character,
          render,
        });
      },
      { hoverTime },
    ),
  ];
};

async function requestHoverTooltip({
  view,
  line,
  character,
  render,
}: {
  view: EditorView;
  line: number;
  character: number;
  render: RenderHover;
}): Promise<Tooltip | null> {
  const lsClient = LSCore.ofOrThrow(view);

  const result = await lsClient.requestWithLock("textDocument/hover", {
    textDocument: { uri: lsClient.documentUri },
    position: { line, character },
  });

  if (!result) {
    return null;
  }

  const { contents, range } = result;
  let pos = posToOffset(view.state.doc, { line, character });
  let end: number | undefined;

  if (range) {
    pos = posToOffset(view.state.doc, range.start);
    end = posToOffset(view.state.doc, range.end);
  }

  if (pos == null) {
    return null;
  }

  if (isEmptyDocumentation(contents)) {
    return null;
  }

  const dom = document.createElement("div");
  await render(dom, contents);

  return {
    pos,
    end,
    create: (_view) => ({ dom }),
    above: true,
  };
}
