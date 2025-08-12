# Codemirror Client library

`codemirror-ls` is a Codemirror client library for connecting a Codemirror editor to a language server.

The library is designed to make it easy to use arbitrary "renderer"s to actually display language server widgets like tooltips or context menus, so you can use your favorite libraries, like React, to render components.

To use `codemirror-ls`, you have to:

1) Set up a `Transport`. This is an implementation of `LSITransport` that contains methods for registering message callbacks and sending messages to a language server. We provide a simple reference implementation of a WebSocket transport that assumes WebSocket input messages are raw output from stdout of an LSP process. This is a bit unique from other Codemirror language server clients out there -- our reference WebSocket transport needs to receive the raw output including `Content-Length` and all. It should be simple to change this behavior in a custom transport.
2) Create a `LSClient`. The `LSClient` wraps the transport and provides utility methods that are internally used by plugins but also exposed. It is useful if you want to add your own additional extensions or also make LSP calls. You can reuuse an `LSClient` and memoize it if you want to share a language server between editors.
3) Create actual extensions. There is a utility `languageServerWithClient` function to easily construct a large array of all language server extensions and configure everything at once. Under the hood, it is just constructing the extensions using the extensions "getters" this library exports, and then passing along your parameters. Importantly, if you decide to NOT use this helper, make sure that you provide a `LSClient` before any language server Codemirror extensions in your Codemirror extensions array.

A simple example that uses React to render components may look like 


```tsx
import { LSContents } from "./components/LSContents";
import { useMemo, useCallback, useState } from "react";
import ReactDOM from "react-dom/client";
import { LSContextMenu } from "./components/LSContextMenu";
import { LSSignatureHelp } from "./components/LSSignatureHelp";
import { LSGoTo } from "./components/LSGoTo";
import { LSWindow } from "./components/LSWindow";
import type * as LSP from "vscode-languageserver-protocol";
import { languageServerWithClient, LSClient } from "codemirror-ls";
import { LSWebSocketTransport } from "codemirror-ls/transport";
    
const wsTransport = new LSWebSocketTransport(url);

const lsClient = new LSClient({
  transport: newTransport,
  workspaceFolders: [{ uri: "file:///demo", name: "Demo" }],
});

const lspExtensions = languageServerWithClient({
  client: lsClient,
  documentUri: `file://${path}`,
  languageId: "typescript",
  sendIncrementalChanges: false,
  sendDidOpen: true,
  features: {
    signatureHelp: {
      render: async (dom, data, activeSignature, activeParameter) => {
        const root = ReactDOM.createRoot(dom);
        root.render(
          <LSSignatureHelp
            data={data}
            activeParameter={activeParameter}
            activeSignature={activeSignature}
          />,
        );
      },
    },
    linting: {
      render: async (dom, message) => {
        const root = ReactDOM.createRoot(dom);
        root.render(<LSContents contents={message} />);
      },
    },
    references: {
      render: async (dom, references, goToReference, onClose, kind) => {
        const root = ReactDOM.createRoot(dom);
        root.render(
          <LSGoTo
            onClose={onClose}
            locations={references}
            goTo={goToReference}
            kind={kind}
          />,
        );
      },
      modClickForDefinition: true,
      onExternalReference: (uri) => {
        console.log("Go to external reference", uri);
      },
      goToDefinitionShortcuts: ["F12"],
      modClickForDefinition: true,
    },
  },
});

const editorView = new EditorView({
  extensions: [
    basicSetup,
    javascript(),
    ...lspExtensions,
  ],
  parent: document.body,
});
```

Currently, our library provides the following extensions:
- **Completions**: These are the list of editor suggestions you get as you type.
- **Renames**: Symbol renaming. This is, for example, useful for when you want to rename a variable or function.
- **Signatures**: Method or function signatures that pop up as you type out a function call.
- **Hovers**: Hover tooltips that you receive when you hover over symbols.
- **Context Menu**: A context menu that is triggered by right clicking a symbol. This hijacks the native context menu.
- **Linting**: Red, gray, or yellow squiggles under "bad code." May also include associated code action buttons.
- **References**: For viewing a list of places a symbol is referenced, or for go to definition.
- **Window**: For warning messages from the LSP.

## Renderers

Many of the extensions take a "renderer" as a parameter. A Renderer is just a callback that takes a dom, followed by some useful metadata, and is expected to append children to the dom to display the metadata's content.