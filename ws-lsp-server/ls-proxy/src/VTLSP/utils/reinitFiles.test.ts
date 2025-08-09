import { expect } from "@std/expect";
import { ensureDir, ensureFile } from "@std/fs";
import { join } from "@std/path";
import { FileChangeType } from "vscode-languageserver-protocol";
import { calculateReinitFiles, type ReinitFile, type ReinitFilesOptions } from "./reinitFiles.ts";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";

describe("calculateReinitFiles", () => {
  let testTempDir: string;
  let protectedFiles: Set<string>;
  let mockFileContents: Map<string, string>;
  let options: ReinitFilesOptions;

  beforeEach(() => {
    testTempDir = Deno.makeTempDirSync({ prefix: "reinit-test-" });
    protectedFiles = new Set(["deno.json", "env-vars.ts"]);
    mockFileContents = new Map<string, string>();

    const getFileContent = (path: string): string => {
      return mockFileContents.get(path) || "";
    };

    options = {
      tempDir: testTempDir,
      protectedFiles,
      getFileContent,
    };
  });

  afterEach(() => {
    try {
      Deno.removeSync(testTempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create all files when starting from empty directory", async () => {
    // Starting state: empty directory
    // Desired state: two files
    const allFiles: ReinitFile[] = [
      { uri: `file://${join(testTempDir, "file1.ts")}`, text: "console.log('hello');" },
      { uri: `file://${join(testTempDir, "file2.ts")}`, text: "export const x = 1;" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(0);
    expect(result.createdFiles.length).toBe(2);
    expect(result.changedFiles.length).toBe(0);
    expect(result.fileEvents.length).toBe(2);

    expect(result.fileEvents).toEqual(
      expect.arrayContaining([
        { uri: `file://${join(testTempDir, "file1.ts")}`, type: FileChangeType.Created },
        { uri: `file://${join(testTempDir, "file2.ts")}`, type: FileChangeType.Created },
      ]),
    );
  });

  it("should delete files not in the desired state (excluding protected files)", async () => {
    // Create existing files
    const existingFile = join(testTempDir, "existing-file.ts");
    const protectedFile = join(testTempDir, "deno.json");
    const keepFile = join(testTempDir, "keep-file.ts");

    await ensureFile(existingFile);
    await ensureFile(protectedFile);
    await ensureFile(keepFile);

    await Deno.writeTextFile(existingFile, "old content");
    await Deno.writeTextFile(protectedFile, "{}");
    await Deno.writeTextFile(keepFile, "keep this");

    mockFileContents.set(keepFile, "keep this");

    // Desired state: only keep-file.ts and a new file
    const allFiles: ReinitFile[] = [
      { uri: `file://${keepFile}`, text: "keep this" },
      { uri: `file://${join(testTempDir, "new-file.ts")}`, text: "console.log('hello');" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(1);
    expect(result.createdFiles.length).toBe(1);
    expect(result.changedFiles.length).toBe(0);

    expect(result.deletedFiles).toEqual(expect.arrayContaining([existingFile]));
    expect(result.fileEvents).toEqual(
      expect.arrayContaining([
        { uri: `file://${existingFile}`, type: FileChangeType.Deleted },
        { uri: `file://${join(testTempDir, "new-file.ts")}`, type: FileChangeType.Created },
      ]),
    );
  });

  it("should detect changed files when content differs", async () => {
    // Create existing file
    const existingFilePath = join(testTempDir, "existing-file.ts");
    await ensureFile(existingFilePath);
    await Deno.writeTextFile(existingFilePath, "old content");
    mockFileContents.set(existingFilePath, "old content");

    // Desired state: same file with new content
    const allFiles: ReinitFile[] = [
      { uri: `file://${existingFilePath}`, text: "new content" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(0);
    expect(result.createdFiles.length).toBe(0);
    expect(result.changedFiles.length).toBe(1);

    expect(result.changedFiles).toEqual(expect.arrayContaining([existingFilePath]));
    expect(result.fileEvents).toEqual(
      expect.arrayContaining([
        { uri: `file://${existingFilePath}`, type: FileChangeType.Changed },
      ]),
    );
  });

  it("should not mark unchanged files as changed", async () => {
    // Create existing file
    const existingFile = join(testTempDir, "unchanged-file.ts");
    await ensureFile(existingFile);
    await Deno.writeTextFile(existingFile, "same content");
    mockFileContents.set(existingFile, "same content");

    // Desired state: same file with same content
    const allFiles: ReinitFile[] = [
      { uri: `file://${existingFile}`, text: "same content" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(0);
    expect(result.createdFiles.length).toBe(0);
    expect(result.changedFiles.length).toBe(0);
    expect(result.fileEvents.length).toBe(0);
  });

  it("should handle complex scenario with mixed operations", async () => {
    // Setup: Create some existing files
    const fileToDelete = join(testTempDir, "file-to-delete.ts");
    const fileToChange = join(testTempDir, "file-to-change.ts");
    const fileToKeep = join(testTempDir, "file-to-keep.ts");
    const protectedFile = join(testTempDir, "env-vars.ts");

    await ensureFile(fileToDelete);
    await ensureFile(fileToChange);
    await ensureFile(fileToKeep);
    await ensureFile(protectedFile);

    await Deno.writeTextFile(fileToDelete, "delete me");
    await Deno.writeTextFile(fileToChange, "old content");
    await Deno.writeTextFile(fileToKeep, "keep me");
    await Deno.writeTextFile(protectedFile, "protected content");

    mockFileContents.set(fileToChange, "old content");
    mockFileContents.set(fileToKeep, "keep me");

    // Desired state: keep one file unchanged, change another, create a new one
    // fileToDelete is not included, so it should be deleted
    // protectedFile is not included but should not be deleted due to protection
    const allFiles: ReinitFile[] = [
      { uri: `file://${fileToChange}`, text: "new content" },
      { uri: `file://${fileToKeep}`, text: "keep me" },
      { uri: `file://${join(testTempDir, "new-file.ts")}`, text: "brand new" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(1);
    expect(result.createdFiles.length).toBe(1);
    expect(result.changedFiles.length).toBe(1);
    expect(result.fileEvents.length).toBe(3);

    expect(result.deletedFiles).toEqual(expect.arrayContaining([fileToDelete]));
    expect(result.createdFiles).toEqual(expect.arrayContaining([join(testTempDir, "new-file.ts")]));
    expect(result.changedFiles).toEqual(expect.arrayContaining([fileToChange]));

    // Verify protected file is not deleted
    expect(result.deletedFiles.includes(protectedFile)).toBe(false);
  });

  it("should handle nested directory structures", async () => {
    const nestedDir = join(testTempDir, "nested", "deep");
    await ensureDir(nestedDir);

    const nestedFile = join(nestedDir, "nested-file.ts");
    await ensureFile(nestedFile);
    await Deno.writeTextFile(nestedFile, "nested content");

    // Desired state: only root file, nested file should be deleted
    const allFiles: ReinitFile[] = [
      { uri: `file://${join(testTempDir, "root-file.ts")}`, text: "root content" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(1);
    expect(result.createdFiles.length).toBe(1);

    expect(result.deletedFiles).toEqual(expect.arrayContaining([nestedFile]));
    expect(result.createdFiles).toEqual(
      expect.arrayContaining([join(testTempDir, "root-file.ts")]),
    );
  });

  it("should preserve protected files even when not in desired state", async () => {
    // Create protected files
    const protectedFile1 = join(testTempDir, "deno.json");
    const protectedFile2 = join(testTempDir, "env-vars.ts");
    const normalFile = join(testTempDir, "normal.ts");

    await ensureFile(protectedFile1);
    await ensureFile(protectedFile2);
    await ensureFile(normalFile);

    await Deno.writeTextFile(protectedFile1, "{}");
    await Deno.writeTextFile(protectedFile2, "export const API_KEY = 'test';");
    await Deno.writeTextFile(normalFile, "console.log('test');");

    // Desired state: only a new file (protected files not included)
    const allFiles: ReinitFile[] = [
      { uri: `file://${join(testTempDir, "new-file.ts")}`, text: "new content" },
    ];

    const result = await calculateReinitFiles(allFiles, options);

    expect(result.deletedFiles.length).toBe(1);
    expect(result.createdFiles.length).toBe(1);

    // Only normal file should be deleted
    expect(result.deletedFiles).toEqual(expect.arrayContaining([normalFile]));
    expect(result.deletedFiles.includes(protectedFile1)).toBe(false);
    expect(result.deletedFiles.includes(protectedFile2)).toBe(false);
  });
});
