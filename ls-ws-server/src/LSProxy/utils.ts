import * as path from "node:path";
import { URI } from "vscode-uri";

const FILE_URI_PATTERN = /(file:\/\/[^\s"']+)/g;

/**
 * Whether `candidate` resolves to `dir` or a descendant of it, using
 * canonicalized absolute paths and a path-separator boundary. This is the
 * single containment predicate for both URI conversions: it rejects prefix
 * siblings (`/tmp/x-evil/…` vs `/tmp/x`), `..` escapes and encoded dot
 * segments that naive `startsWith(dir)` checks miss.
 *
 * @param candidate A (possibly relative) filesystem path.
 * @param dir The directory to test containment against.
 * @returns True if `path.resolve(candidate)` is `dir` or a child of it.
 */
function isPathInside(candidate: string, dir: string): boolean {
  const normCandidate = path.resolve(candidate);
  const normDir = path.resolve(dir);
  return (
    normCandidate === normDir ||
    normCandidate.startsWith(`${normDir}${path.sep}`)
  );
}

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
  if (obj === null || typeof obj !== "object") {
    return structuredClone(obj);
  }

  // If the input is an array, recurse on each item
  if (Array.isArray(obj)) {
    return obj.map((item) => replaceFileUris(item, convertUri));
  }

  // If the input is an object, recurse on each key-value pair, and do replacements on keys
  // and recursive calls on values
  const result: Record<string, unknown> = {};

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
): obj is object | unknown[] | undefined {
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
): obj is object | unknown[] | string | null {
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
 * Only `file://` URIs and plain paths can be materialized as local files.
 * Any other URI scheme (http, untitled, …) is rejected with `undefined` —
 * previously it was returned unchanged, which let callers write
 * `new URL(uri).pathname` as an absolute host path (arbitrary file
 * write / container RCE).
 *
 * The result is always a `file://` URI whose pathname is strictly inside
 * `tempDir`; inputs that would escape (raw or encoded `..`, prefix siblings)
 * are rejected with `undefined`.
 *
 * Examples (tempDir = "/tmp/dir"):
 * - "file://foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "/foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "foobar.tsx" -> "file:///tmp/dir/foobar.tsx"
 * - "file:///tmp/dir/foobar.tsx" -> unchanged (already temp)
 * - "http://example.com/foobar.tsx" -> undefined (rejected)
 * - "file:///tmp/dir/../etc/passwd" -> undefined (rejected)
 */
export function virtualUriToTempDirUri(
  pathOrUri: string,
  tempDir: string,
): string | undefined {
  // Reject non-file URI schemes: they cannot be mapped into the temp dir and
  // must never reach a filesystem sink (C1).
  if (/^\w+:/i.test(pathOrUri) && !pathOrUri.startsWith("file://")) {
    return undefined;
  }

  try {
    const virtualPath = pathOrUri.startsWith("file://")
      ? URI.parse(pathOrUri).fsPath
      : pathOrUri;

    // Already inside the temp dir: canonicalize before returning so that any
    // `..` / encoded-dot segments are resolved at parse time — they must not
    // survive into a later `new URL(...).pathname` re-normalization (P7-004).
    if (isPathInside(virtualPath, tempDir)) {
      return URI.from({
        scheme: "file",
        path: path.resolve(virtualPath),
      }).toString();
    }

    // Join into the temp dir, then verify the joined result stays inside.
    // `path.join`/`resolve` normalize `..` and absolute ingredients, so an
    // escaping input resolves outside the tree and is rejected instead of
    // being written.
    const joined = virtualPath.startsWith("/")
      ? virtualPath
      : `/${virtualPath}`;
    const realPath = path.resolve(path.join(tempDir, joined));
    if (!isPathInside(realPath, tempDir)) {
      return undefined;
    }

    return URI.from({ scheme: "file", path: realPath }).toString();
  } catch {
    return undefined;
  }
}

/**
 * Convert a real temp file URI/path to a virtual URI.
 *
 * Non-file URIs are passed through; temp-dir paths are mapped back to their
 * virtual form using the same canonical containment predicate (so prefix
 * siblings like `/tmp/dir-evil/…` are left alone rather than mis-mapped).
 *
 * Examples (tempDir = "/tmp/dir"):
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

  const actualPath = pathOrUri.startsWith("file://")
    ? URI.parse(pathOrUri).path
    : pathOrUri;

  // Only strip the temp prefix for paths that canonically live inside tempDir.
  const resolved = path.resolve(actualPath);
  if (isPathInside(resolved, tempDir)) {
    const normDir = path.resolve(tempDir);
    const relativePath = resolved.substring(normDir.length);
    return URI.from({ scheme: "file", path: relativePath || "/" }).toString();
  }

  // Not a temp path: ensure it starts with / and return as file URI
  if (!actualPath.startsWith("/")) {
    return URI.from({ scheme: "file", path: `/${actualPath}` }).toString();
  }

  return URI.from({ scheme: "file", path: actualPath }).toString();
}
