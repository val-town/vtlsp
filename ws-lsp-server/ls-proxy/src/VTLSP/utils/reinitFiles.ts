import { fromFileUrl, toFileUrl } from "@std/path";
import { walkSync } from "@std/fs";
import { FileChangeType, type FileEvent } from "vscode-languageserver-protocol";

export interface ReinitFile {
  uri: string;
  text: string;
}

export interface ReinitFilesResult {
  fileEvents: FileEvent[];
  deletedFiles: string[];
  createdFiles: string[];
  changedFiles: string[];
}

export interface ReinitFilesOptions {
  tempDir: string;
  protectedFiles: Set<string>;
  getFileContent: (path: string) => Promise<string | undefined> | (string | undefined);
}

/**
 * Compares current files in temp directory with new files and determines what changes need to be made.
 * Returns file events that can be sent to the LSP and lists of files that were deleted, created, or changed.
 */
export async function calculateReinitFiles(
  newFiles: ReinitFile[],
  options: ReinitFilesOptions,
): Promise<ReinitFilesResult> {
  const { tempDir, protectedFiles, getFileContent } = options;

  const deletedFilePaths = new Set<string>();
  const createdFilePaths = new Set<string>();
  const changedFilePaths = new Set<string>();

  const currentFilePaths = Array.from(walkSync(tempDir))
    .filter((e) => e.isFile) // Only include files, not directories
    .map((e) => e.path);

  const newFilePaths = new Set<string>(
    newFiles.map((f) => fromFileUrl(f.uri)),
  );

  // First delete all files that are not in the new files list
  // but exclude protected files from deletion
  for (const file of currentFilePaths) {
    const fileName = file.split("/").pop() || "";
    if (!newFilePaths.has(file) && !protectedFiles.has(fileName)) {
      deletedFilePaths.add(file);
    }
  }

  // Then create all files that are in the new files list but not
  // in the current files list
  for (const file of newFilePaths) {
    if (!currentFilePaths.includes(file)) {
      createdFilePaths.add(file);
    } else {
      // Check if the file actually changed
      const currentContent = await getFileContent(file);
      const newFileData = newFiles.find((f) => fromFileUrl(f.uri) === file);
      if (newFileData && currentContent !== newFileData.text) {
        changedFilePaths.add(file);
        deletedFilePaths.delete(file);
        createdFilePaths.delete(file);
      }
    }
  }

  // Create proper file change events
  const fileEvents = [
    ...Array.from(deletedFilePaths).map((file) => ({
      uri: toFileUrl(file).toString(),
      type: FileChangeType.Deleted,
    })) as FileEvent[],
    ...Array.from(createdFilePaths).map((file) => ({
      uri: toFileUrl(file).toString(),
      type: FileChangeType.Created,
    })),
    ...Array.from(changedFilePaths).map((file) => ({
      uri: toFileUrl(file).toString(),
      type: FileChangeType.Changed,
    })),
  ] as FileEvent[];

  return {
    fileEvents,
    deletedFiles: Array.from(deletedFilePaths),
    createdFiles: Array.from(createdFilePaths),
    changedFiles: Array.from(changedFilePaths),
  };
}
