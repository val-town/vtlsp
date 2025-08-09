import type { Extension } from "@codemirror/state";

/**
 * A renderer is a function that takes an HTML element and additional arguments,
 * and maybe applies some rendering logic to the element.
 *
 * This is useful for using external rendering libraries like React to render
 * onto codemirror elements.
 */
export type Renderer<T extends any[]> = (
  element: HTMLElement,
  ...args: T
) => Promise<void>;

/**
 * An extension getter is a function that yields LSP codemirror extensions.
 */
export type LSExtensionGetter<T = void> = (params: T) => Extension[];
