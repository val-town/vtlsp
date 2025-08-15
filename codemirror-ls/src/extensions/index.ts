/**
 * @module index
 * @description Entry point for all editor extensions.
 * 
 * Every extension export provides a "get"-extensions function that returns
 * an array of extensions that can be used with codemirror.
 */

export * as completions from "./completions.js";
export * as contextMenu from "./contextMenu.js";
export * as hovers from "./hovers.js";
export * as linting from "./linting.js";
export * as references from "./references.js";
export * as renames from "./renames.js";
export * as signatures from "./signatures.js";
export type { Renderer } from "./types.js";
export * as window from "./window.js";
