#!/usr/bin/env -S deno run -A

/**
 * Very simple supervisor that runs a command and propagates various debug information on
 * non-graceful crashes.
 */

import { $, ExecaError } from "execa";

const CRASH_LOG_LINE_COUNT = Deno.env.get("CRASH_LOG_LINE_COUNT") || "50";
const BETTERSTACK_API_KEY = Deno.env.get("BETTERSTACK_API_KEY");
const BETTERSTACK_LSP_URL = Deno.env.get("BETTERSTACK_LSP_URL");

let childProc: ReturnType<typeof $> | null = null;
let shuttingDown = false;
const stderrBuffer: string[] = [];

const gracefulShutdown = (signal: Deno.Signal) => async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);
  await ensureChildProcDead(signal);
  console.log(`Child process terminated with signal: ${signal}`);
  const exitReport = await generateReport("Exit", signal);
  console.log(exitReport);
  await logToBetterstack(exitReport);
  Deno.exit(signal === "SIGINT" ? 130 : 143);
}

Deno.addSignalListener("SIGTERM", gracefulShutdown("SIGTERM"));
Deno.addSignalListener("SIGINT", gracefulShutdown("SIGINT"));

childProc = $(Deno.args[0], Deno.args.slice(1), {
  stderr: "pipe",
  stdout: "inherit",
  env: {
    DENO_DIR: "/app/.deno_dir",
    CRASH_LOG_LINE_COUNT,
    EXIT_ON_LS_BAD_EXIT: "1",
    // Note: do not give parent (our) env vars to the child (such as betterstack API key)
  },
});

childProc.stderr?.on("data", (data: string) => {
  const line = String(data).trim();
  if (line) {
    stderrBuffer.push(line);
    const maxLines = parseInt(CRASH_LOG_LINE_COUNT);
    if (stderrBuffer.length > maxLines) {
      stderrBuffer.splice(0, stderrBuffer.length - maxLines);
    }
  }
});

await childProc.catch(async (error) => {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!(error instanceof ExecaError)) {
    console.error("Supervisor encountered an unexpected error:", error);
    Deno.exit(1);
  }

  const crashReport = await generateReport("Crash");
  const errorReport = [
    crashReport,
    `Supervisor Error (execa): ${error.message}`,
    `Exit Code: ${error.exitCode}`,
    `Exit cause: ${error.cause}`,
  ].join("\n");

  console.error(errorReport);

  if (error.signal !== "SIGTERM") { // if this isn't totally graceful send the logs
    await logToBetterstack(errorReport);
  }

  Deno.exit(error.exitCode || 1);
});

async function ensureChildProcDead(signal: string): Promise<void> {
  if (!childProc) return;
  childProc.kill(signal);
  await childProc.catch(() => { console.warn("Child process terminated."); });
}

async function generateReport(
  type: "Crash" | "Exit",
  signal?: string,
): Promise<string> {
  const serverTail = await getResultStringOrErrorString(async () =>
    (await $("tail", ["-n", CRASH_LOG_LINE_COUNT, "./lsp-server.log"])).stdout
  );

  const serverStats = await getResultStringOrErrorString(async () => {
    const { stdout } = await $`free -h`;
    return stdout.trim();
  });

  const signalInfo = signal ? `Signal: ${signal}\n` : "";
  const stderrInfo = stderrBuffer.length > 0 ? `Stderr:\n${stderrBuffer.slice(-100).join("\n")}\n` : "";

  return [
    `=== LSP Service ${type} Report ===`,
    `Command: ${Deno.args[0]} ${Deno.args.slice(1).join(" ")}`,
    `Current Directory: ${Deno.cwd()}`,
    signalInfo,
    stderrInfo,
    `Last ${CRASH_LOG_LINE_COUNT} lines of lsp-server.log:\n${serverTail}`,
    `Container Stats:\n${serverStats}`,
    `=== End of LSP Service ${type} Report ===`,
  ].filter((line) => line).join("\n");
}

async function logToBetterstack(message: string): Promise<void> {
  if (!BETTERSTACK_API_KEY || !BETTERSTACK_LSP_URL) {
    console.warn("BetterStack API key or URL not set, skipping log dump.");
    return;
  }

  try {
    const response = await fetch(`${BETTERSTACK_LSP_URL}/api/v1/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BETTERSTACK_API_KEY}`,
      },
      body: JSON.stringify({
        message,
        tags: ["lsp-service", "supervisor"],
      }),
    });

    if (!response.ok) {
      console.error("Failed to log to BetterStack:", response.statusText);
    }
  } catch (err) {
    console.error("Failed to log to BetterStack:", err);
  }
}

async function getResultStringOrErrorString<T>(
  fn: () => T | Promise<T>,
): Promise<string> {
  try {
    return String(await fn());
  } catch (e) {
    return e instanceof Error
      ? `Error: ${e.message}`
      : `Unknown error: ${String(e)}`;
  }
}
