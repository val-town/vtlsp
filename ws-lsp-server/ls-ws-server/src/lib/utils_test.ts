import { assertEquals } from "@std/assert";
import { removeApiKeyFromString } from "./utils.ts";

Deno.test("removeApiKeyFromString - single API key", () => {
  const input = "This is a string with API key vtwn_abcdefghijklmn.";
  const expected = "This is a string with API key vtwn_xxxxxxxxxxxxxx.";
  const actual = removeApiKeyFromString(input);
  assertEquals(actual, expected);
});

Deno.test("removeApiKeyFromString - multiple API keys", () => {
  const input = 'API key 1: vtwn_123456789012, API key 2: "vtwn_abcdefghijklmn".';
  const expected = 'API key 1: vtwn_xxxxxxxxxxxx, API key 2: "vtwn_xxxxxxxxxxxxxx".';
  const actual = removeApiKeyFromString(input);
  assertEquals(actual, expected);
});

Deno.test("removeApiKeyFromString - no API key", () => {
  const input = "This is a string without any API keys.";
  const expected = "This is a string without any API keys.";
  const actual = removeApiKeyFromString(input);
  assertEquals(actual, expected);
});
