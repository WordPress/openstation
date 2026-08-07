/**
 * os-ui — public barrel for the whole UI kit.
 *
 * Import once from the shell entry so every component upgrades
 * before anything else renders:
 *
 *     import './ui';
 *
 * Callers that only want the core primitives (to author new
 * components) should import from `./ui/core` instead.
 */

export * from './core';
export * from './components';
