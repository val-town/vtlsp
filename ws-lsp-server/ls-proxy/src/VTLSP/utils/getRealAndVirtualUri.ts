import { URI } from "vscode-uri";
import { join } from "@std/path";

/**
 * Convert a virtual URI/path to a real temp file URI.
 *
 * Examples:
 * - "file://foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "/foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "http://example.com/foobar.tsx" -> "http://example.com/foobar.tsx" (unchanged)
 * - "file:///tmp/dir/foobar.tsx" -> "file:///tmp/dir/foobar.tsx" (unchanged if already temp)
 */
export function getRealUri(pathOrUri: string, tempDir: string): string | undefined {
  // If it's a non-file URI, return as is
  if (/^\w+:/i.test(pathOrUri) && !pathOrUri.startsWith("file://")) {
    return pathOrUri;
  }

  try {
    let virtualPath: string;

    if (pathOrUri.startsWith("file://")) {
      const parsedUri = URI.parse(pathOrUri);
      // If already in temp dir, return as is
      if (parsedUri.fsPath.startsWith(tempDir)) {
        return pathOrUri;
      }
      virtualPath = parsedUri.fsPath;
    } else {
      // Handle absolute or relative paths
      if (pathOrUri.startsWith(tempDir)) {
        return URI.from({ scheme: "file", path: pathOrUri }).toString();
      }
      virtualPath = pathOrUri;
    }

    // Ensure virtual path starts with /
    if (!virtualPath.startsWith("/")) {
      virtualPath = "/" + virtualPath;
    }

    // Join with temp directory and return as URI
    const realPath = join(tempDir, virtualPath);
    return URI.from({ scheme: "file", path: realPath }).toString();
  } catch {
    return undefined;
  }
}

/**
 * Convert a real temp file URI/path to a virtual URI.
 *
 * Examples:
 * - "file:///tmp/dir/foobar.tsx" -> "file:///foobar.tsx"
 * - "/tmp/dir/foobar.tsx" -> "file:///foobar.tsx"
 * - "/foobar.tsx" -> "file:///foobar.tsx" (unchanged if not temp)
 * - "foobar.tsx" -> "file:///foobar.tsx"
 * - "http://example.com/foobar.tsx" -> "http://example.com/foobar.tsx" (unchanged)
 */
export function getVirtualUri(pathOrUri: string, tempDir: string): string {
  // If it's a non-file URI, return as is
  if (/^\w+:/i.test(pathOrUri) && !pathOrUri.startsWith("file://")) {
    return pathOrUri;
  }

  let actualPath: string;

  if (pathOrUri.startsWith("file://")) {
    const uri = URI.parse(pathOrUri);
    actualPath = uri.path;
  } else {
    actualPath = pathOrUri;
  }

  // If it's in the temp directory, remove the temp prefix
  if (actualPath.startsWith(tempDir)) {
    const relativePath = actualPath.substring(tempDir.length);
    return URI.from({
      scheme: "file",
      path: relativePath || "/",
    }).toString();
  }

  // If not a temp path, ensure it starts with / and return as file URI
  if (!actualPath.startsWith("/")) {
    actualPath = "/" + actualPath;
  }

  return URI.from({ scheme: "file", path: actualPath }).toString();
}
