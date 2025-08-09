import { VTLSP } from "./src/VTLSP/VTLSP.ts";

const tempDir = await Deno.makeTempDir({ prefix: "vtlsp-proc" });

new VTLSP({ tempDir })
  .listen();
