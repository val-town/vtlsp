import { expect } from "@std/expect";
import { pathIsLowerThan } from "./pathIsLowerThan.ts";
import { describe, it } from "@std/testing/bdd";

describe("pathIsLowerThan", () => {
  it("should return true when paths are equal", () => {
    expect(pathIsLowerThan("/home/user", "/home/user")).toBe(true);
  });

  it("should return true when first path is a subdirectory of second path", () => {
    expect(pathIsLowerThan("/home/user/docs", "/home/user")).toBe(true);
  });

  it("should return false when first path is a parent of second path", () => {
    expect(pathIsLowerThan("/home", "/home/user")).toBe(false);
  });

  it("should return false when paths are unrelated", () => {
    expect(pathIsLowerThan("/var/log", "/home/user")).toBe(false);
  });

  it("should work with relative paths", () => {
    expect(pathIsLowerThan("./subfolder", ".")).toBe(true);
  });
});
