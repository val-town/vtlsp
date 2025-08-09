import { getJsxDiagnostics } from "./jsxDiagnostics.ts";
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

describe("getJsxPragmaDiagnostic", () => {
  it("should return diagnostic for file with JSX but no pragma", () => {
    const fileWithJsxNoPragma = `
        function App() {
          return <div>Hello World</div>;
        }
       `;

    const diagnostics = getJsxDiagnostics(fileWithJsxNoPragma, "file:///file.tsx");
    expect(diagnostics).not.toBe([]);
    expect(diagnostics[0]?.code).toBe("reflexive-diagnostic");
  });

  it("should return empty result for file with JSX and pragma", () => {
    const fileWithJsxAndPragma = `// @jsxImportSource preact
        function App() {
          return <div>Hello World</div>;
        }
       `;

    const diagnostics = getJsxDiagnostics(fileWithJsxAndPragma, "file:///file.tsx");
    expect(diagnostics).toEqual([]);
  });

  it("should return empty result for file without JSX", () => {
    const fileWithoutJsx = `
        function regularFunction() {
          return "Hello World";
        }
       `;

    const diagnostics = getJsxDiagnostics(fileWithoutJsx, "file:///file.ts");
    expect(diagnostics).toEqual([]);
  });
});
