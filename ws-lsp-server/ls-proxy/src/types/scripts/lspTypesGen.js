/**
 * This script generates TypeScript interfaces for LSP request and notification maps using the
 * official LSP metaModel JSON.
 *
 * export interface LSPNotifyMap {
 *     "workspace/didChangeWorkspaceFolders": LSP.DidChangeWorkspaceFoldersParams;
 *     "window/workDoneProgress/cancel": LSP.WorkDoneProgressCancelParams;
 *     "workspace/didCreateFiles": LSP.CreateFilesParams;
 *     "workspace/didRenameFiles": LSP.RenameFilesParams;
 */

import { process } from "node:process";

const excludeMethods = [
  "$/cancelRequest",
  "$/progress",
  "workspace/textDocumentContent",
  "workspace/textDocumentContent/refresh",
];

function getTypeReference(item) {
  if (!item) return "any";
  switch (item.kind) {
    case "reference":
      return `LSP.${item.name}`;
    case "array":
      return `(${getTypeReference(item.element)})[]`;
    case "base":
      return item.name;
    case "stringLiteral":
      return `"LSP.${item.value}"`;
    case "literal":
      return "{}";
    case "or":
      return item.items.map(getTypeReference).join(" | ");
    case "tuple":
      return `[${item.items.map(getTypeReference).join(", ")}]`;
    default:
      console.warn(`Unknown kind: ${item.kind}`);
      return "any";
  }
}

function generateMap(
  items,
  typeName,
  paramsKey = "params",
  resultKey = "result",
) {
  const mapEntries = items
    .filter((item) => !excludeMethods.includes(item.method))
    .map((item) => {
      if (typeName === "LSPNotifyMap") {
        const paramsType = getTypeReference(item[paramsKey]);
        return `  "${item.method}": ${paramsType};`;
      } else {
        const paramsType = getTypeReference(item[paramsKey]);
        const resultType = getTypeReference(item[resultKey]);
        return `  "${item.method}": [${paramsType}, ${resultType} | null];`;
      }
    })
    .join("\n");

  return `export interface ${typeName} {\n${mapEntries}\n}`;
}

async function generateLSPMaps(metaModelUrl) {
  try {
    const response = await fetch(metaModelUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch metaModel: ${response.status}`);
    }
    const metaModel = await response.json();

    const requestMap = generateMap(metaModel.requests, "LSPRequestMap");
    const notifyMap = generateMap(
      metaModel.notifications,
      "LSPNotifyMap",
      "params",
      "params",
    );

    return `
 import type * as LSP from "vscode-languageserver-protocol";

 ${requestMap}

 ${notifyMap}
  `;
  } catch (error) {
    console.error("Error generating LSP Maps:", error);
    return "// Error generating LSP Maps";
  }
}

process.stdout.write(
  await generateLSPMaps(
    "https://raw.githubusercontent.com/microsoft/vscode-languageserver-node/refs/heads/main/protocol/metaModel.json",
  ),
);
