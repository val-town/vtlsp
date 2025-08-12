import type { LSProxyCode } from "./types.js";

export const codes = {
  cancel_response: "cancel_response",
} as const;

export function hasALsProxyCode(value: unknown): value is { ls_proxy_code: LSProxyCode } {
  if (
    typeof value === "object" &&
    value !== null &&
    "ls_proxy_code" in value &&
    typeof value.ls_proxy_code === "string"
  ) {
    return Object.values(codes).includes(value.ls_proxy_code as LSProxyCode);
  }
  return false;
}
