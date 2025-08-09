// deno-lint-ignore-file no-explicit-any

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
export function replaceFileUris(obj: unknown, convertUri: (str: string) => string): unknown {
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


export function isLspParamsLike(obj: unknown): obj is object | any[] | undefined {
  return (
    typeof obj === "object" ||
    Array.isArray(obj) ||
    obj === undefined
  ) && obj !== null;
}

export function isLspRespLike(obj: unknown): obj is object | any[] | string | null {
  return (
    typeof obj === "object" ||
    Array.isArray(obj) ||
    typeof obj === "string" ||
    obj === null
  );
}
