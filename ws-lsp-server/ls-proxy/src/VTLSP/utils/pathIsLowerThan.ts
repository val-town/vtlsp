import { resolve } from "@std/path";

export function pathIsLowerThan(path: string, basePath: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBasePath = resolve(basePath);

  return resolvedPath.startsWith(resolvedBasePath + "/") || resolvedPath === resolvedBasePath;
}
