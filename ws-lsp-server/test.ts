import { $, ExecaError } from "npm:execa";
import { delay } from "jsr:@std/async";

/**
 * Test runner script that starts the LSP server in a Docker container,
 * runs its test (in the container), and then stops the server when the tests complete.
 */

const port = Deno.args[0]; // The port that the server runs on internally in the container
if (!port) {
  throw new Error("Provide port as the first argument");
}

console.log("Starting server...");

const serverWasRunning = await serverIsRunning();
let proc: ReturnType<typeof $> | undefined;

if (!(await serverIsRunning())) {
  // Await/ensure that the Docker image is built before running the server
  await $({ stdio: "inherit" })`deno task docker:build`;

  // Start the server. We need to catch the exit, so that we don't propagate a
  // good exit as a bad one.
  proc = $`deno task docker:run`;
  proc.catch((error) => {
    if (error instanceof ExecaError) {
      if (error.signal === "SIGTERM") {
        console.log("Server was terminated gracefully.");
      } else {
        console.error("Server exited with an error:", error);
        Deno.exit(error.exitCode || 1);
      }
    } else throw error;
  });

  // Wait for the server to start
  do {
    await delay(1000);
  } while (!(await serverIsRunning()));
} else {
  console.log("Server is already running.");
}

console.log("Running tests...");

let result: Awaited<ReturnType<typeof $>>;
try {
  result = await $("deno", [
    "task",
    "docker:exec",
    "cd /app && deno task test:only -- --ignore=/app/.deno_dir/**/*",
  ], {
    stdio: "inherit",
    env: { "EXIT_ON_LS_BAD_EXIT": "0" },
  });
} catch (error) {
  if (error instanceof ExecaError) {
    const errorReport = [
      `=== LSP Test Crash Report ===`,
      `Command: ${error.command}`,
      `Current Directory: ${Deno.cwd()}`,
      `Exit Code: ${error.exitCode}`,
      `Stderr: ${error.stderr}`,
      `Stdout: ${error.stdout}`,
      `=== End of LSP Test Crash Report ===`,
    ].join("\n");
    console.error(errorReport);

    Deno.exit(error.exitCode || 1);
  } else {
    console.error("An unexpected error occurred while running tests:", error);
    Deno.exit(1);
  }
}

if (result.exitCode !== 0) {
  console.error(`Tests failed with exit code ${result.exitCode}`);
  Deno.exit(1); // Exit with an error code
} else {
  console.log("Tests passed!");
}

shutDownServer();

async function serverIsRunning() {
  try {
    const resp = await fetch(`http://localhost:${port}/ping`);
    return resp.ok;
  } catch {
    return false;
  }
}

function shutDownServer() {
  if (!serverWasRunning) {
    console.log("Stopping server...");
    if (proc) {
      const success = proc.kill("SIGTERM");
      if (success) {
        console.log("Server stopped successfully.");
      } else {
        console.error("Failed to stop the server gracefully.");
        proc.kill("SIGKILL");
      }
    }
  }
}
