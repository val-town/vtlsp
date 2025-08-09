/**
 * We have hopes of eventually using this to present dynamic types to deno. Right now we
 * still haven't figured out invalidation of types when you include URLs in the types field
 * in compilerOptions.
 */

interface HTTPFileServerOptions {
  port?: number;
  host?: string;
  /** Mapping of URL paths to file contents */
  mapping?: Record<string, FileItem>;
  /** Default content type for files without specified type */
  defaultContentType?: string;
  /** Additional HTTP headers to include in responses */
  additionalHeaders?: Record<string, string>;
}

type FileItem = {
  content: string;
  contentType: string;
};

/**
 * A simple HTTP server that serves files from memory at given paths.
 * Makes it very easy to register a fake HTTP file system server.
 */
export class HTTPFileServer {
  public port?: number;
  public host?: string;

  private server: Deno.HttpServer;
  private mapping: Map<string, FileItem>;
  private headers: Headers;
  private defaultContentType: string;

  /**
   * Creates a new HTTP file server
   * @param options Configuration options for the server
   */
  constructor(options?: HTTPFileServerOptions) {
    this.server = Deno.serve({
      port: options?.port ?? 0,
      hostname: options?.host,
      onListen: ({ hostname, port }) => {
        this.port = port;
        this.host = hostname;
      },
    }, this.handle.bind(this));
    this.mapping = new Map(Object.entries(options?.mapping || {}));
    this.headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...options?.additionalHeaders,
    });
    this.defaultContentType = options?.defaultContentType || "plain/text";
  }

  /**
   * Adds a file to the server
   *
   * @param path URL path where the file will be accessible
   * @param fileItem File content and type, or a string (uses default content type)
   */
  addFile(path: string, fileItem: FileItem | string, overwrite = false): this {
    if (!overwrite && this.mapping.has(path)) {
      throw new Error(`File at path "${path}" already exists.`);
    }

    if (typeof fileItem === "string") {
      fileItem = {
        content: fileItem,
        contentType: this.defaultContentType,
      };
    }

    this.mapping.set(path, fileItem);

    return this;
  }

  /**
   * Get the URL of a file on the server.
   *
   * @param path URL path of the file
   * @param mustExist If true, throws an error if the file does not exist
   * @returns The full URL of the file, or undefined if it does not exist
   * @throws Error if mustExist is true and the file does not exist
   */
  getFileUrl(path: string, mustExist: true): string;
  getFileUrl(path: string, mustExist: false): string | undefined;
  getFileUrl(path: string, mustExist: boolean): string | undefined {
    if (mustExist && !this.mapping.has(path)) {
      throw new Error(`File at path "${path}" does not exist.`);
    }

    if (this.mapping.has(path)) {
      return new URL(path, `http://${this.host}:${this.port}`).toString();
    }

    return undefined;
  }

  /**
   * Removes a file from the server
   *
   * @param path URL path of the file to remove
   * @returns true if file was found and removed, false otherwise
   */
  removeFile(path: string): boolean {
    return this.mapping.delete(path);
  }

  /**
   * Handles incoming HTTP requests
   * @param request The incoming request
   * @returns Response to be sent back to the client
   */
  private handle(request: Request): Response {
    const url = new URL(request.url);
    const path = url.pathname;

    if (this.mapping.has(path)) {
      const content = this.mapping.get(path)!;
      return new Response(content.content, {
        status: 200,
        headers: { "Content-Type": content.contentType, ...this.headers },
      });
    } else {
      return new Response("Not Found", { status: 404 });
    }
  }

  /**
   * Stops the HTTP server
   */
  async close(): Promise<void> {
    await this.server.shutdown();
  }
}
