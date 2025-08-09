import { expandGlob } from "@std/fs/expand-glob";
import { $ } from "execa";

/**
 * Cache dependencies for all files in a folder
 *
 * We use `deno info` because it works no matter what, even if the file has broken javascript
 * syntax. This function:
 * 1) Creates a temporary file with all imports from the specified directory
 *    by globbing for all .ts, .js, .jsx, and .tsx files, and then appending
 *   `import "..."` statements for each file into one file.
 * 2) Calls `deno info -I` on that file to cache all dependencies.
 *
 * @param folderPath The folder path to cache dependencies for
 */
export async function cacheFolderFilesDeps(folderPath: string): Promise<void | string> {
  const tempFileWithAllImports = await getFileWithAllImports(folderPath);

  try {
    await $("deno", ["info", "-I", tempFileWithAllImports]);
  } finally {
    await Deno.remove(tempFileWithAllImports);
  }
}

async function getFileWithAllImports(folderPath: string): Promise<string> {
  const tempFileWithAllImports = await Deno.makeTempFile();
  using tempFileWithAllImportsFd = await Deno
    .open(tempFileWithAllImports, {
      append: true,
      create: true,
      write: true,
    });

  for await (const file of expandGlob(`${folderPath}/**/*.{ts,js,jsx,tsx}`)) {
    await tempFileWithAllImportsFd.write(new TextEncoder().encode(`import "${file.path}";\n`));
  }

  return tempFileWithAllImports;
}

export { getFileWithAllImports as _getFileWithAllImports };
