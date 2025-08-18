import { describe, it, expect } from "vitest";
import type * as LSP from "vscode-languageserver-protocol";
import { referencesOfKindSupported, type ReferenceKind } from "./references.js";

describe("referencesOfKindSupported", () => {
  it("should return true when definitionProvider is true", () => {
    const capabilities: LSP.ServerCapabilities = {
      definitionProvider: true,
    };

    expect(
      referencesOfKindSupported(capabilities, "textDocument/definition"),
    ).toBe(true);
  });

  it("should return false when capability is undefined", () => {
    const capabilities: LSP.ServerCapabilities = {};

    expect(
      referencesOfKindSupported(capabilities, "textDocument/definition"),
    ).toBe(false);
  });

  it("should return false when capability is not boolean true", () => {
    const capabilities: LSP.ServerCapabilities = {
      definitionProvider: { workDoneProgress: true },
    };

    expect(
      referencesOfKindSupported(capabilities, "textDocument/definition"),
    ).toBe(false);
  });

  it("should handle all reference kinds correctly", () => {
    const capabilities: LSP.ServerCapabilities = {
      definitionProvider: true,
      typeDefinitionProvider: true,
      implementationProvider: true,
      referencesProvider: true,
    };

    const kinds: ReferenceKind[] = [
      "textDocument/definition",
      "textDocument/typeDefinition",
      "textDocument/implementation",
      "textDocument/references",
    ];

    kinds.forEach((kind) => {
      expect(referencesOfKindSupported(capabilities, kind)).toBe(true);
    });
  });
});
