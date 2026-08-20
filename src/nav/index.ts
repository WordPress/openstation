/**
 * Navigation model — public barrel.
 *
 * `desktop-sync` is deliberately absent: it imports the files layer,
 * and a bundle that only wants `computeNav` should not drag that in.
 */

export * from './types';
export * from './defaults';
export * from './order';
export * from './compute';
export * from './registry';
export * from './config';
