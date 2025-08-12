import { describe, it, expect } from "vitest";
import { chunkByteArray} from "./WSStream.js";

describe("chunkByteArray", () => {
  it("provides evenly divisible chunks", () => {
    // Create a test array [0, 1, 2, 3, 4, 5]
    const testArray = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const chunkSize = 2;

    const chunks = Array.from(chunkByteArray(testArray, chunkSize));

    // Should result in 3 chunks: [0,1], [2,3], [4,5]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual(new Uint8Array([0, 1]));
    expect(chunks[1]).toEqual(new Uint8Array([2, 3]));
    expect(chunks[2]).toEqual(new Uint8Array([4, 5]));
  });

  it("can handle non-evenly divisible chunks", () => {
    // Create a test array [0, 1, 2, 3, 4, 5, 6]
    const testArray = new Uint8Array([0, 1, 2, 3, 4, 5, 6]);
    const chunkSize = 3;

    const chunks = Array.from(chunkByteArray(testArray, chunkSize));

    // Should result in 3 chunks: [0,1,2], [3,4,5], [6]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual(new Uint8Array([0, 1, 2]));
    expect(chunks[1]).toEqual(new Uint8Array([3, 4, 5]));
    expect(chunks[2]).toEqual(new Uint8Array([6]));
  });
});
