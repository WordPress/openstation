/**
 * Origin snapshot taken at shell module load.
 *
 * Every same-origin gate inside the shell (postMessage listeners,
 * link interception, redirect validation) compares against this
 * value so a plugin script that mutates `window.location` mid-
 * session can't relax the cross-origin guards by changing what
 * the gate sees.
 *
 * Lives in its own module so every boot-time consumer reaches the
 * same captured value: a single `const INITIAL_ORIGIN = …` inside
 * one consumer's module would not be shared with another.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 */

export const INITIAL_ORIGIN: string = window.location.origin;
