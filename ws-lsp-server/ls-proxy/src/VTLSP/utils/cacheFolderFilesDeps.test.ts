import { ensureDir, ensureFile } from "@std/fs";
import { join } from "@std/path";
import { _getFileWithAllImports } from "./cacheFolderFilesDeps.ts";
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

describe("cacheFolderFilesDeps ", () => {
  it("caches dependencies for files in a folder", async () => {
    const testDir = await Deno.makeTempDir({ prefix: "cache-deps-test-" });

    try {
      await ensureDir(join(testDir, "src"));
      await ensureDir(join(testDir, "src/utils"));

      await ensureFile(join(testDir, "src/main.ts"));
      await ensureFile(join(testDir, "src/utils/helper.ts"));
      await ensureFile(join(testDir, "src/utils/data.jsx"));

      await Deno.writeTextFile(join(testDir, "src/main.ts"), 'import "./utils/helper.ts";');
      await Deno.writeTextFile(
        join(testDir, "src/utils/helper.ts"),
        'export const helper = () => "helper";',
      );
      await Deno.writeTextFile(
        join(testDir, "src/utils/data.js"),
        "export const data = { value: 123 };",
      );

      const fileWithImports = await _getFileWithAllImports(testDir);
      const fileWithImportsContent = await Deno.readTextFile(fileWithImports);
      expect(fileWithImportsContent).toContain(`import "${testDir}/src/utils/data.js";`);
      expect(fileWithImportsContent).toContain(`import "${testDir}/src/utils/data.jsx";`);
      expect(fileWithImportsContent).toContain(`import "${testDir}/src/utils/helper.ts";`);
    } finally {
      // Clean up the test directory
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
