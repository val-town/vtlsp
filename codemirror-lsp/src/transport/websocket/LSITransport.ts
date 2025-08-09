/**
 * Interface for a JSON-RPC client that provides methods for handling communication
 * with a JSON-RPC server using notifications and requests.
 */
export interface LSITransport {
  /**
   * Registers a handler for incoming notifications with the specified method name.
   * Use "*" as the method to handle all notifications.
   *
   * @param method - The name of the notification method to listen for, or "*" for all
   * @param handler - The function to call when a notification with the specified method is received
   * @return A function to unregister the handler
   */
  onNotification: (
    handler: (method: string, params: unknown) => void
  ) => () => void;

  /**
   * Sends a notification to the server with the specified method and optional parameters.
   * Notifications do not expect a response.
   *
   * @param method - The name of the notification method to send
   * @param params - Optional parameters to include with the notification
   */
  sendNotification: (method: string, params?: unknown) => void;

  /**
   * Sends a request to the server and returns a promise that resolves with the response.
   *
   * @template T - The expected type of the response
   * @param method - The name of the request method to send
   * @param params - Optional parameters to include with the request
   * @returns A promise that resolves with the server's response
   */
  sendRequest: (method: string, params?: unknown) => Promise<unknown>;

  /**
   * Registers a handler for incoming requests
   *
   * @param handler The function to call when a request is made
   * @return A function to unregister the handler
   */
  onRequest: (
    handler: (method: string, params: unknown) => unknown
  ) => () => void;

  /**
   * Registers an error handler that will be called when JSON-RPC errors occur.
   *
   * @param handler - The function to call when an error occurs
   * @return A function to unregister the error handler
   */
  onError: (handler: (error: unknown) => void) => () => void;

  /**
   * Closes the transport connection and cleans up resources.
   */
  close?: () => void;
}
