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

export class ToLSTransform extends Transform {
  private _state: ReceiveState;
  private _curContentLength: number = 0;
  private _curChunk: Buffer;

  private constructor(options?: TransformOptions) {
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

    const prefixMinLength = Buffer.byteLength(
      "Content-Length: 0\r\n\r\n",
      encoding,
    );
    const prefixLength = Buffer.byteLength("Content-Length: ", encoding);
    const prefixRegex = /^Content-Length: /i;
    const digitLength = Buffer.byteLength("0", encoding);
    const digitRe = /^[0-9]/;
    const suffixLength = Buffer.byteLength("\r\n\r\n", encoding);
    const suffixRe = /^\r\n\r\n/;

    while (true) {
      if (this._state === "content-length") {
        // Not enough data for a content length match
        if (this._curChunk.length < prefixMinLength) {
          break;
        }

        const leading = this._curChunk.subarray(0, prefixLength);
        if (!prefixRegex.test(leading.toString(encoding))) {
          cb(
            new Error(
              `[_transform] Bad header: ${this._curChunk.toString(encoding)}`,
            ),
          );
          return;
        }

        let numString = "";
        let position = leading.length;
        while (this._curChunk.length - position > digitLength) {
          const ch = this._curChunk
            .subarray(position, position + digitLength)
            .toString(encoding);
          if (!digitRe.test(ch)) {
            break;
          }

          numString += ch;
          position += 1;
        }

        if (
          position === leading.length ||
          this._curChunk.length - position < suffixLength ||
          !suffixRe.test(
            this._curChunk
              .subarray(position, position + suffixLength)
              .toString(encoding),
          )
        ) {
          cb(
            new Error(
              `[_transform] Bad header: ${this._curChunk.toString(encoding)}`,
            ),
          );
          return;
        }

        this._curContentLength = Number(numString);
        this._curChunk = this._curChunk.subarray(position + suffixLength);
        this._state = "jsonrpc";
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
      }

      break;
    }
    cb();
  }

  private _reencode(chunk: Buffer, chunkEncoding: NodeJS.BufferEncoding) {
    if (this.readableEncoding && this.readableEncoding !== chunkEncoding) {
      return chunk.toString(this.readableEncoding);
    } else if (this.readableEncoding) {
      // this should be the most common case, i.e. we're using an encoded source stream
      return chunk.toString(chunkEncoding);
    } else {
      return chunk;
    }
  }

  public static createStream(
    readStream?: Readable,
    options?: TransformOptions,
  ): ToLSTransform {
    const jrt = new ToLSTransform(options);
    if (readStream) {
      readStream.pipe(jrt);
    }
    return jrt;
  }
}

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

      // Create the complete message as a string and then convert to buffer
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

/**
 * Takes an input stream of bytes, process/parses into LSP messages, and then
 * re-outputs as a stream of bytes, but as chunks that are entire LSP messages.
 *
 * @param inputStream The input stream of bytes, for example from WebSocket connection.
 * @param outputStream The output stream of bytes, for example to stdin of LSP process.
 */
export function pipeLsInToLsOut(
  inputStream: Readable,
  outputStream: Writable,
  middleware?: (chunk: string) => string | null,
) {
  const preLsTransform = ToLSTransform.createStream(inputStream);

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
    preLsTransform.pipe(middlewareTransform);
    postLsTransform.pipe(outputStream);
  } else {
    const postLsTransform = FromLSTransform.createStream(preLsTransform);
    postLsTransform.pipe(outputStream);
  }
}
