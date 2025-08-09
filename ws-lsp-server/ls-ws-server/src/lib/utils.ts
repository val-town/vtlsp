import prettyFileTree from "pretty-file-tree";
import { walk } from "@std/fs";

export function removeApiKeyFromString(str: string): string {
  return str.replace(/vtwn_[a-zA-Z0-9]{12,}/g, (match) => "vtwn_" + "x".repeat(match.length - 5));
}

export async function getPrettyFileTree(dirPath: string): Promise<string> {
  try {
    const entries = await Array.fromAsync(walk(dirPath, { includeDirs: false }));
    const filePaths = entries.map((entry) => entry.path);

    return filePaths.length > 0 ? prettyFileTree(filePaths) : "";
  } catch {
    return "";
  }
}
