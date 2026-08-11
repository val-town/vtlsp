// From https://github.com/ImperiumMaximus/ts-lsp-client

import { Buffer } from "node:buffer";
import { once } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import type { JSONRPCRequest, JSONRPCResponse } from "json-rpc-2.0";
import { describe, expect, it } from "vitest";
import { pipeLsInToLsOut, ToLSTransform } from "./LSTransform.ts";

const mockReadStreamOK = (
  jsonRPC:
    | JSONRPCResponse
    | JSONRPCRequest
    | JSONRPCResponse[]
    | JSONRPCRequest[]
    | (JSONRPCRequest | JSONRPCResponse)[]
    | string
    | string[],
) => {
  const readable = new Readable();
  const jsonRPCs = Array.isArray(jsonRPC) ? jsonRPC : [jsonRPC];
  jsonRPCs.forEach((j) => {
    if (typeof j !== "string") {
      const jsonRPCStr = JSON.stringify(j);
      readable.push(
        `Content-Length: ${jsonRPCStr.length}\r\n\r\n${jsonRPCStr}`,
      );
    } else {
      readable.push(j);
    }
  });
  readable.push(null);

  return readable;
};

const mockReadStreamKO = (jsonRPC: JSONRPCResponse | JSONRPCRequest) => {
  const readable = new Readable();
  const jsonRPCStr = JSON.stringify(jsonRPC);
  readable.push(`Content-Length: invalid\r\n\r\n${jsonRPCStr}`);
  readable.push(null);

  return readable;
};

describe("JSONRPCTransform", () => {
  it("unpacks a raw JSON RPC response into an JSONRPCResponse instance", async () => {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 0,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ["."],
          },
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: ["quickfix", "refactor.extract"],
          },
          codeLensProvider: { resolveProvider: false },
          renameProvider: true,
        },
      },
    };

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(response),
    );
    const jsonrpc = (await once(jsonRpcTransform, "data"))[0];
    expect(jsonrpc).toEqual(JSON.stringify(response));
  });

  it("unpacks a raw JSON RPC request into an JSONRPCRequest instance", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 2673 },
      },
    };

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(request),
    );
    const jsonrpc = (await once(jsonRpcTransform, "data"))[0];
    expect(jsonrpc).toEqual(JSON.stringify(request));
  });

  it("throws an error with a bad header", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 2673 },
      },
    };

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamKO(request),
    );

    const errorMessage = (await once(jsonRpcTransform, "error"))[0];
    expect(errorMessage.message).toContain("Bad header");
  });

  it("calls callback more than once with multiple JSONRPCs", async () => {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ["."],
          },
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: ["quickfix", "refactor.extract"],
          },
          codeLensProvider: { resolveProvider: false },
          renameProvider: true,
        },
      },
    };
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 3000 },
      },
    };
    const payload = [response, request];
    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(payload),
    );

    let payloadIdx = 0;
    for await (const j of jsonRpcTransform) {
      expect(j).toEqual(JSON.stringify(payload[payloadIdx++]));
    }
  });

  it("process multiple JSONs in one _transform", async () => {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ["."],
          },
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: ["quickfix", "refactor.extract"],
          },
          codeLensProvider: { resolveProvider: false },
          renameProvider: true,
        },
      },
    };
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 3000 },
      },
    };

    const jsonRpcResponseStr = JSON.stringify(response);
    const jsonRpcRequestStr = JSON.stringify(request);

    const payload = [request, response];
    const payloadSingle = `Content-Length: ${jsonRpcRequestStr.length}\r\n\r\n${jsonRpcRequestStr}Content-Length: ${jsonRpcResponseStr.length}\r\n\r\n${jsonRpcResponseStr}`;

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(payloadSingle),
    );

    let payloadIdx = 0;
    for await (const j of jsonRpcTransform) {
      expect(j).toEqual(JSON.stringify(payload[payloadIdx++]));
    }
  });

  it("buffers partial JSONs", async () => {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ["."],
          },
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: ["quickfix", "refactor.extract"],
          },
          codeLensProvider: { resolveProvider: false },
          renameProvider: true,
        },
      },
    };
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 3000 },
      },
    };

    const jsonRpcResponseStr = JSON.stringify(response);
    const jsonRpcRequestStr = JSON.stringify(request);

    const payload = [response, request];
    const payloadSplit = [
      `Content-Length: ${jsonRpcResponseStr.length}\r\n\r\n${jsonRpcResponseStr}Content-Length: ${jsonRpcRequestStr.length}\r\n\r\n${jsonRpcRequestStr.substring(
        0,
        50,
      )}`,
      jsonRpcRequestStr.substring(50),
    ];

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(payloadSplit),
    );

    let payloadIdx = 0;
    for await (const j of jsonRpcTransform) {
      expect(j).toEqual(JSON.stringify(payload[payloadIdx++]));
    }
  });

  it("buffers partial JSONs within the same RPC", async () => {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: ["."],
          },
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: ["quickfix", "refactor.extract"],
          },
          codeLensProvider: { resolveProvider: false },
          renameProvider: true,
        },
      },
    };
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      method: "telemetry/event",
      params: {
        properties: { Feature: "ApexPrelude-startup", Exception: "None" },
        measures: { ExecutionTime: 3000 },
      },
    };

    const jsonRpcResponseStr = JSON.stringify(response);
    const jsonRpcRequestStr = JSON.stringify(request);

    const payload = [response, request];
    const payloadSplit = [
      `Content-Length: ${jsonRpcResponseStr.length}\r\n\r\n${jsonRpcResponseStr}`,
      `Content-Length: ${jsonRpcRequestStr.length}\r\n\r\n${jsonRpcRequestStr.substring(0, 50)}`,
      jsonRpcRequestStr.substring(50),
    ];

    const jsonRpcTransform = ToLSTransform.createStream(
      mockReadStreamOK(payloadSplit),
    );

    let payloadIdx = 0;
    for await (const j of jsonRpcTransform) {
      expect(j).toEqual(JSON.stringify(payload[payloadIdx++]));
    }
  });
});

const createExampleInput = (randomText = crypto.randomUUID() as string) => {
  const inputRequest = JSON.stringify({
    jsonrpc: "2.0",
    method: "telemetry/event",
    params: {
      "Param-To-Check": randomText,
    },
  });

  const byteLength = Buffer.byteLength(inputRequest, "utf8");
  const header = `Content-Length: ${byteLength}\r\n\r\n`;
  const entireRequest = `${header}${inputRequest}`;

  const inputStream = new Readable({
    read() {
      this.push(header);
      const buffer = Buffer.from(inputRequest, "utf8");

      for (let i = 0; i < buffer.length; i++) {
        this.push(Buffer.from([buffer[i]]));
      }

      this.push(null);
    },
  });

  return { inputRequest, header, entireRequest, inputStream, randomText };
};

describe("pipeLsInToLsOut", () => {
  it("pipeLsInToLsOut transforms input to identical output, but in a single chunk", async () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
      createExampleInput(
        `request${i + 1}${Array.from({ length: 8 }, () => crypto.randomUUID()).join("")}`,
      ),
    );

    const receivedChunks: string[] = [];
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        const chunkStr = chunk.toString();
        receivedChunks.push(chunkStr);
        callback();
      },
    });

    // Start all pipelines
    requests.forEach(({ inputStream }) => {
      pipeLsInToLsOut(inputStream, outputStream);
    });

    await once(outputStream, "finish");

    expect(receivedChunks).toHaveLength(8);
    requests.forEach(({ randomText }) => {
      const containsRequest = receivedChunks.some((chunk) =>
        chunk.includes(randomText),
      );
      expect(containsRequest).toBe(true);
    });
  });

  it("control case simply pumps input to output, but not in order", async () => {
    // sanity check
    function pipeLsInToSimplePassThroughToLsOut(
      inputStream: Readable,
      outputStream: Writable,
    ) {
      const passThrough = new PassThrough();
      inputStream.pipe(passThrough);
      passThrough.pipe(outputStream);
    }

    const requests = Array.from({ length: 8 }, (_, i) =>
      createExampleInput(`request${i + 1}`),
    );

    const receivedChunks: string[] = [];
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        const chunkStr = chunk.toString();
        receivedChunks.push(chunkStr);
        callback();
      },
    });

    // Start all pipelines
    requests.forEach(({ inputStream }) => {
      pipeLsInToSimplePassThroughToLsOut(inputStream, outputStream);
    });

    await once(outputStream, "finish");

    expect(receivedChunks.length).toBeGreaterThan(8);
    requests.forEach(({ randomText }) => {
      const containsRequest = receivedChunks.some(
        (chunk) => !chunk.includes(randomText),
      );
      expect(containsRequest).toBe(true);
    });
  });
});

describe("ToLSTransform regression tests (H2/H3 fixes)", () => {
  const collect = (
    inputChunks: (string | Buffer)[],
    options?: ConstructorParameters<typeof ToLSTransform.createStream>[1],
  ) => {
    const input = new Readable();
    for (const c of inputChunks) {
      input.push(Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8"));
    }
    input.push(null);
    const transform = ToLSTransform.createStream(input, options);
    const data: string[] = [];
    const errors: Error[] = [];
    transform.on("data", (d) => data.push(d.toString()));
    transform.on("error", (e) => errors.push(e));
    return new Promise<{ data: string[]; errors: Error[] }>((resolve) => {
      input.on("end", () => setTimeout(() => resolve({ data, errors }), 20));
    });
  };

  it("accepts a spec-valid multi-header frame (Content-Length + Content-Type)", async () => {
    const { data, errors } = await collect([
      "Content-Length: 5\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\nhello",
    ]);
    expect(errors).toHaveLength(0);
    expect(data).toEqual(["hello"]);
  });

  it("accepts a valid header split across chunks (previously crashed)", async () => {
    const { data, errors } = await collect([
      "Content-Length: 12345",
      `\r\n\r\n${"x".repeat(12345)}`,
    ]);
    expect(errors).toHaveLength(0);
    expect(data).toEqual(["x".repeat(12345)]);
  });

  it("accepts LF-only line endings", async () => {
    const { data, errors } = await collect(["Content-Length: 5\n\nhello"]);
    expect(errors).toHaveLength(0);
    expect(data).toEqual(["hello"]);
  });

  it("accepts byte-split header fragments", async () => {
    const { data, errors } = await collect([
      "Content-Len",
      "gth: 10\r\n",
      "\r\n",
      "0123456789",
    ]);
    expect(errors).toHaveLength(0);
    expect(data).toEqual(["0123456789"]);
  });

  it("still buffers incomplete bodies across chunks", async () => {
    const { data, errors } = await collect([
      "Content-Length: 10\r\n\r\n0123",
      "456789",
    ]);
    expect(errors).toHaveLength(0);
    expect(data).toEqual(["0123456789"]);
  });

  it("rejects a Content-Length above maxContentLength (H3)", async () => {
    const { data, errors } = await collect(
      [`Content-Length: 101\r\n\r\n${"x".repeat(101)}`],
      { maxContentLength: 100 },
    );
    expect(data).toHaveLength(0);
    expect(errors[0]?.message).toContain("exceeds maximum");
  });

  it("defaults to a finite maxContentLength (unbounded-accumulation fix)", async () => {
    const { errors } = await collect([
      `Content-Length: ${1024 * 1024}\r\n\r\n`,
    ]);
    // 1 MiB > default 500 KB cap; the declared length alone is rejected before any body
    expect(errors[0]?.message).toContain("exceeds maximum");
  });

  it("errors cleanly on an oversized unterminated header", async () => {
    const { errors } = await collect(["X".repeat(70 * 1024)], {
      maxHeaderSize: 64 * 1024,
    });
    expect(errors[0]?.message).toContain("Bad header");
  });

  it("still reports clearly malformed header values as Bad header", async () => {
    const { errors } = await collect(["Content-Length: invalid\r\n\r\n{}"]);
    expect(errors[0]?.message).toContain("Bad header");
    const { errors: e2 } = await collect(["this line has no colon\r\n\r\n{}"]);
    expect(e2[0]?.message).toContain("Bad header");
  });
});

describe("pipeLsInToLsOut error wiring (H2)", () => {
  it("surfaces a parse error on the output stream instead of crashing", async () => {
    const input = new Readable();
    input.push("Content-Length: invalid\r\n\r\n{}");
    input.push(null);
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const errors: Error[] = [];
    output.on("error", (e: Error) => errors.push(e));

    pipeLsInToLsOut(input, output);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("Bad header");
  });

  it("forwards middleware parse failures to the output stream", async () => {
    const input = new Readable();
    input.push("Content-Length: 5\r\n\r\nhello");
    input.push(null);
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const errors: Error[] = [];
    output.on("error", (e: Error) => errors.push(e));

    pipeLsInToLsOut(input, output, () => {
      throw new Error("middleware boom");
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("middleware boom");
  });
});
