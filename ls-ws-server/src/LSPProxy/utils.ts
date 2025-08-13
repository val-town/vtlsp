import * as path from "node:path";
import { URI } from "vscode-uri";

const FILE_URI_PATTERN = /(file:\/\/[^\s"']+)/g;

/**
 * Recursively process both keys and values of an object to update all file URIs in all keys
 * and values.
 *
 * Since the keys of the object might change, we operate unknown -> unknown.
 *
 * @param obj The object to process, which can be an object, array, or string.
 * @param convertUri A function that takes a string and returns a modified string.
 * @returns A new object with all file URIs replaced according to the callback.
 */
export function replaceFileUris(
  obj: unknown,
  convertUri: (str: string) => string,
): unknown {
  // If the input is a string, replace all URIs in the string
  if (typeof obj === "string") {
    return obj.replace(FILE_URI_PATTERN, convertUri);
  }
  // If the input is not an object or array, return it as is
  else if (obj === null || typeof obj !== "object") {
    return structuredClone(obj);
  }

  // If the input is an array, recurse on each item
  if (Array.isArray(obj)) {
    return obj.map((item) => replaceFileUris(item, convertUri));
  }

  // If the input is an object, recurse on each key-value pair, and do replacements on keys
  // and recursive calls on values
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = key.replace(FILE_URI_PATTERN, convertUri);
    result[newKey] = replaceFileUris(value, convertUri);
  }

  return result;
}

/**
 * Check if the given object is a valid LSP parameters-like object.
 * This includes objects, arrays, or undefined.
 *
 * @param obj The object to check.
 * @returns True if the object is a valid LSP parameters-like object, false otherwise.
 */
export function isLspParamsLike(
  obj: unknown,
): obj is object | any[] | undefined {
  return (
    (typeof obj === "object" || Array.isArray(obj) || obj === undefined) &&
    obj !== null
  );
}

/**
 * Check if the given object is a valid LSP response-like object.
 * This includes objects, arrays, strings, or null.
 *
 * @param obj The object to check.
 * @returns True if the object is a valid LSP response-like object, false otherwise.
 */
export function isLspRespLike(
  obj: unknown,
): obj is object | any[] | string | null {
  return (
    typeof obj === "object" ||
    Array.isArray(obj) ||
    typeof obj === "string" ||
    obj === null
  );
}

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
export function virtualUriToTempDirUri(
  pathOrUri: string,
  tempDir: string,
): string | undefined {
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
    const realPath = path.join(tempDir, virtualPath);
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
export function tempDirUriToVirtualUri(
  pathOrUri: string,
  tempDir: string,
): string {
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
