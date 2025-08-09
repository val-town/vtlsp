import { z } from "zod";

/**
 * Formats text using Deno's formatter with the provided configuration.
 *
 * @param text - The text content to format
 * @param path - The file path (used to determine file extension)
 * @param config - Deno formatting configuration options
 * @returns A promise that resolves to the formatted text
 */
export async function denoFormat({
  text,
  path,
  config,
}: {
  text: string;
  path: string;
  config?: DenoFormatConfiguration;
}): Promise<string> {
  const tempConfigPath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    const denoJsonConfig = { fmt: config };

    if (config) {
      await Deno.writeTextFile(tempConfigPath, JSON.stringify(denoJsonConfig));
    }

    const extension = path.split(".").pop();
    const extensionArgs = extension ? [`--ext=${extension}`] : [];
    const configArgs = config ? [`--config=${tempConfigPath}`] : [];

    const process = new Deno.Command("deno", {
      args: ["fmt", "-", ...configArgs, ...extensionArgs],
      env: { "NO_COLOR": "1" },
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    });

    const child = process.spawn();

    const encoder = new TextEncoder();
    const writer = child.stdin.getWriter();
    await writer.write(encoder.encode(text));
    await writer.close();

    const output = await child.output();

    if (output.code !== 0) {
      const errorMessage = new TextDecoder().decode(output.stderr);
      throw new Error(`Deno formatter error (code ${output.code}): ${errorMessage}`);
    }

    const formattedText = new TextDecoder().decode(output.stdout);
    return formattedText.slice(0, -1); // Remove the trailing newline character
  } catch (e) {
    if (!Error.isError(e)) throw new Error(String(e), { cause: e });
    if (e.message.includes("Deno formatter error")) {
      return text;
    } else {
      throw new Error(`Failed to format text: ${e.message}`, { cause: e });
    }
  }
  finally {
    await Deno.remove(tempConfigPath);
  }
}

export const DenoFormatConfigurationSchema = z.object({
  bracePosition: z.enum(["maintain", "sameLine", "nextLine", "sameLineUnlessHanging"]).optional(),
  jsx: z
    .object({
      bracketPosition: z.enum(["maintain", "sameLine", "nextLine"]).optional(),
      forceNewLinesSurroundingContent: z.boolean().optional(),
      multiLineParens: z.enum(["never", "prefer", "always"]).optional(),
    })
    .optional(),
  indentWidth: z.number().int().min(0).optional(),
  lineWidth: z.number().int().min(0).optional(),
  newLineKind: z.enum(["auto", "crlf", "lf", "system"]).optional(),
  nextControlFlowPosition: z.enum(["sameLine", "nextLine", "maintain"]).optional(),
  semiColons: z.boolean().optional(),
  operatorPosition: z.enum(["sameLine", "nextLine", "maintain"]).optional(),
  proseWrap: z.enum(["always", "never", "preserve"]).optional(),
  quoteProps: z.enum(["asNeeded", "consistent", "preserve"]).optional(),
  singleBodyPosition: z.enum(["sameLine", "nextLine", "maintain", "sameLineUnlessHanging"])
    .optional(),
  singleQuote: z.boolean().optional(),
  spaceAround: z.boolean().optional(),
  spaceSurroundingProperties: z.boolean().optional(),
  trailingCommas: z.enum(["always", "never"]).optional(),
  typeLiteral: z
    .object({
      separatorKind: z.enum(["comma", "semiColon"]).optional(),
    })
    .optional(),
  "unstable-component": z.boolean().optional(),
  "unstable-sql": z.boolean().optional(),
  useTabs: z.boolean().optional(),
  useBraces: z.enum(["maintain", "whenNotSingleLine", "always", "preferNone"]).optional(),
});

export type DenoFormatConfiguration = z.infer<typeof DenoFormatConfigurationSchema>;
