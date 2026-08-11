// From https://github.com/ImperiumMaximus/ts-lsp-client

import { Buffer } from "node:buffer";
import {
  Readable,
  Transform,
  type TransformCallback,
  type TransformOptions,
  type Writable,
} from "node:stream";
import { defaultLogger } from "~/logger.js";

type ReceiveState = "content-length" | "jsonrpc";

/**
 * Options for the inbound LSP frame parser.
 */
export interface ToLSTransformOptions extends TransformOptions {
  /**
   * Maximum accepted `Content-Length` for a single inbound LSP message, in bytes.
   *
   * Prevents an attacker-declared (or attacker-trickled) `Content-Length` from driving
   * unbounded memory accumulation (previously the relay buffered every byte of a frame
   * regardless of its declared length). Defaults to 500 KB, matching LSWSServer's
   * documented `maxMessageSize` default.
   */
  maxContentLength?: number;
  /**
   * Maximum size of a single header section, in bytes. Bounds how much data is buffered
   * while waiting for a header terminator and caps pathological header fields.
   * Defaults to 64 KB.
   */
  maxHeaderSize?: number;
}

const DEFAULT_MAX_CONTENT_LENGTH = 500 * 1024; // 500 KB
const DEFAULT_MAX_HEADER_SIZE = 64 * 1024; // 64 KB

/**
 * Take a raw input stream of bytes, parse out LSP messages, and re-output as a
 * stream of bytes, but as chunks that are entire LSP messages.
 *
 * We want to send full LSP messages to the language server process in case we
 * have multiple workers sending chunks to the language server at the same time.
 *
 * The parser is an incremental, line-based header state machine: it buffers until a
 * complete header section is available, tolerates additional header fields (the LSP
 * base protocol permits `Content-Type` and other fields), accepts `\r\n` or `\n` line
 * endings, and only reports an error for genuinely malformed input. Partial headers,
 * spec-valid multi-header frames and frames whose header is split across chunks are
 * buffered, never treated as fatal.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol
 */
export class ToLSTransform extends Transform {
  private _state: ReceiveState;
  private _curContentLength: number;
  private _curChunk: Buffer;
  private _headerBytes: number;
  private _pendingContentLength: number | undefined;

  private readonly maxContentLength: number;
  private readonly maxHeaderSize: number;

  private constructor(options?: ToLSTransformOptions) {
    options = options || {};
    options.objectMode = true;
    super(options);

    this.on("pipe", (src) => {
      if (!this.readableEncoding) {
        if (src instanceof Readable) {
          this.setEncoding(src.readableEncoding!);
        }
      }
    });

    this._curChunk = Buffer.from([]);
    this._state = "content-length";
    this._curContentLength = 0;
    this._headerBytes = 0;
    this._pendingContentLength = undefined;
    this.maxContentLength =
      options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.maxHeaderSize = options.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE;
  }

  public override _transform(
    chunk: Buffer | string,
    encoding: NodeJS.BufferEncoding,
    cb: TransformCallback,
  ): void {
    // decode binary chunks as UTF-8
    encoding = encoding || "utf8";

    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk, encoding);
    }

    this._curChunk = Buffer.concat([this._curChunk, chunk]);

    while (true) {
      if (this._state === "content-length") {
        // Find the next line terminator (\n). A complete line is the smallest unit
        // we act on; partial lines simply buffer (no premature "bad header").
        const newline = this._curChunk.indexOf(0x0a); // '\n'
        if (newline === -1) {
          // No complete line yet: guard against unbounded buffering of a partial
          // header line, then wait for more data.
          if (this._curChunk.length > this.maxHeaderSize) {
            this.#failHeader(
              cb,
              `header section exceeds ${this.maxHeaderSize} bytes without a line terminator`,
            );
            return;
          }
          break; // wait for the rest of the header line
        }

        let line = this._curChunk.subarray(0, newline);
        this._curChunk = this._curChunk.subarray(newline + 1);
        // tolerate \r\n line endings
        if (line.length > 0 && line[line.length - 1] === 0x0d) {
          line = line.subarray(0, line.length - 1);
        }
        this._headerBytes += line.length + 1;

        if (this._headerBytes > this.maxHeaderSize) {
          this.#failHeader(
            cb,
            `header section exceeds ${this.maxHeaderSize} bytes`,
          );
          return;
        }

        if (line.length === 0) {
          // Blank line: header section complete.
          const contentLength = this._pendingContentLength;
          if (contentLength === undefined) {
            this.#failHeader(cb, "missing Content-Length header");
            return;
          }
          if (contentLength > this.maxContentLength) {
            cb(
              new Error(
                `[ToLSTransform] Content-Length ${contentLength} exceeds maximum ${this.maxContentLength} bytes`,
              ),
            );
            return;
          }
          this._curContentLength = contentLength;
          this._pendingContentLength = undefined;
          this._headerBytes = 0;
          this._state = "jsonrpc";
          // Fall through: the body (or more) may already be buffered.
        } else {
          // Header field line: "Name: value" (RFC 7230; split at the first colon).
          const colon = line.indexOf(0x3a); // ':'
          if (colon === -1) {
            this.#failHeader(
              cb,
              `malformed header line: ${line.toString(encoding)}`,
            );
            return;
          }
          const name = line
            .subarray(0, colon)
            .toString(encoding)
            .trim()
            .toLowerCase();
          const value = line
            .subarray(colon + 1)
            .toString(encoding)
            .trim();
          if (name === "content-length") {
            if (!/^[0-9]+$/.test(value)) {
              this.#failHeader(cb, `invalid Content-Length value: ${value}`);
              return;
            }
            // Bound the numeric surface: header size cap already limits digit count.
            this._pendingContentLength = Number(value);
          }
          // Any other header field (e.g. Content-Type) is accepted and ignored.
          continue; // keep scanning the header section / buffered body
        }
      }

      if (this._state === "jsonrpc") {
        if (this._curChunk.length >= this._curContentLength) {
          this.push(
            this._reencode(
              this._curChunk.subarray(0, this._curContentLength),
              encoding,
            ),
          );
          this._curChunk = this._curChunk.subarray(this._curContentLength);
          this._state = "content-length";

          continue;
        }
        // Body incomplete: bounded by maxContentLength, so wait for the remainder.
        break;
      }
    }
    cb();
  }

  #failHeader(cb: TransformCallback, detail: string) {
    cb(new Error(`[ToLSTransform] Bad header: ${detail}`));
  }

  private _reencode(chunk: Buffer, chunkEncoding: NodeJS.BufferEncoding) {
    if (this.readableEncoding && this.readableEncoding !== chunkEncoding) {
      return chunk.toString(this.readableEncoding);
    }
    if (this.readableEncoding) {
      // this should be the most common case, i.e. we're using an encoded source stream
      return chunk.toString(chunkEncoding);
    }
    return chunk;
  }

  public static createStream(
    readStream?: Readable,
    options?: ToLSTransformOptions,
  ): ToLSTransform {
    const jrt = new ToLSTransform(options);
    if (readStream) {
      readStream.pipe(jrt);
    }
    return jrt;
  }
}

/**
 * Takes object LSP messages as input and formats them according to LSP spec to
 * add things like the Content-Length header. Outputs as a stream of bytes that
 * conforms to the LSP protocol.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol
 */
export class FromLSTransform extends Transform {
  private _encoding: NodeJS.BufferEncoding;

  private constructor(options?: TransformOptions) {
    options = options || {};
    // We expect objects as input
    options.objectMode = true;
    super(options);
    this._encoding = (options.encoding as NodeJS.BufferEncoding) || "utf8";
  }

  public override _transform(
    chunk: unknown,
    _encoding: string,
    cb: TransformCallback,
  ): void {
    if (typeof chunk !== "string") {
      chunk = String(chunk);
    }

    if (typeof chunk !== "string") {
      cb(
        new Error(
          `[FromLSTransform] Input chunk must be a string, got ${typeof chunk} (${chunk})`,
        ),
      );
      return;
    }

    try {
      // Get the byte length of the JSON content using the specified encoding
      const contentLength = Buffer.byteLength(chunk, this._encoding);

      // Create the header
      const header = `Content-Length: ${contentLength}\r\n\r\n`;

      // Create the complete message as a buffer
      const message = header + chunk;
      const messageBuffer = Buffer.from(message, this._encoding);

      // Push the formatted message
      this.push(messageBuffer);
      cb();
    } catch (error) {
      cb(new Error(`[FromLSTransform] Failed to transform: ${error}`));
    }
  }

  public override setEncoding(encoding: NodeJS.BufferEncoding): this {
    this._encoding = encoding;
    return super.setEncoding(encoding);
  }

  public static createStream(
    readStream?: Readable,
    options?: TransformOptions,
  ): FromLSTransform {
    const jrt = new FromLSTransform(options);
    if (readStream) {
      readStream.pipe(jrt);
    }
    return jrt;
  }
}

export interface PipeLsOptions {
  /**
   * Inbound per-message size cap applied to the parsed `Content-Length`
   * (see {@link ToLSTransformOptions.maxContentLength}).
   */
  maxContentLength?: number;
}

/**
 * Takes an input stream of bytes, process/parses into LSP messages, and then
 * re-outputs as a stream of bytes, but as chunks that are entire LSP messages.
 *
 * @param inputStream The input stream of bytes, for example from WebSocket connection.
 * @param outputStream The output stream of bytes, for example to stdin of LSP process.
 * @param middleware Optional per-message middleware applied between the two transforms.
 * @param options Optional parsing options (e.g. `maxContentLength`).
 */
export function pipeLsInToLsOut(
  inputStream: Readable,
  outputStream: Writable,
  middleware?: (chunk: string) => string | null,
  options: PipeLsOptions = {},
) {
  const preLsTransform = ToLSTransform.createStream(inputStream, options);

  // A parse error on any intermediate transform must never become an unhandled
  // 'error' event (which previously crashed the whole process). Forward it to the
  // output endpoint; consumers with handlers there (LSWSServer attaches them to
  // stdinProducer / webSocketOut) then close the connection cleanly. The piped
  // input auto-unpipes from a failed destination, so it needs no explicit destroy.
  const forwardError = (error: Error) => {
    outputStream.destroy(error);
  };
  preLsTransform.on("error", forwardError);

  if (middleware) {
    const middlewareTransform = new Transform({
      objectMode: true,
      transform(
        chunk: Buffer,
        encoding: NodeJS.BufferEncoding,
        cb: TransformCallback,
      ) {
        const result = middleware(chunk.toString(encoding));
        if (result == null) return cb();
        defaultLogger.debug(`LS pipe middleware transformed chunk: ${result}`);
        cb(null, Buffer.from(result, encoding));
      },
    });

    const postLsTransform = FromLSTransform.createStream(middlewareTransform);
    middlewareTransform.on("error", forwardError);
    postLsTransform.on("error", forwardError);
    preLsTransform.pipe(middlewareTransform);
    postLsTransform.pipe(outputStream);
  } else {
    const postLsTransform = FromLSTransform.createStream(preLsTransform);
    postLsTransform.on("error", forwardError);
    postLsTransform.pipe(outputStream);
  }
}
