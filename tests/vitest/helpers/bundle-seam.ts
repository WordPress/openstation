/**
 * Build a bundle seam inside Vitest.
 *
 * Vitest imports both sides of a seam into ONE module graph, so a
 * module-level `Map` looks shared here no matter what — and in the
 * browser it is not: each Vite bundle compiles its own copy. That is
 * the one class of bug the rest of the suite structurally cannot see.
 *
 * `vi.resetModules()` between two dynamic imports re-evaluates the
 * module, yielding two independent instances — which is exactly what
 * two Vite IIFE bundles produce at runtime. State that is genuinely
 * shared (`createSharedStore`, keyed on the page rather than on the
 * module) survives the split; plain module-level state does not.
 *
 * See AGENTS.md, "Cross-bundle state — wp.os.createSharedStore", and
 * `bundle-shared-state.test.ts`, which checks the same seams against
 * the BUILT bundles.
 */

import { vi } from 'vitest';

/**
 * Two independent module instances of the same file, standing in for
 * two bundles that both compile it.
 *
 * Callers pass thunks rather than a path because a dynamic import
 * specifier has to be statically analysable relative to the file it
 * appears in. Give each thunk a distinct query suffix
 * (`'../../src/foo?bundle-a'`) so the two stay out of each other's
 * module cache; the `vi.resetModules()` calls are what force
 * re-evaluation of the whole transitive graph.
 *
 * @param loadA Thunk importing the module for the first "bundle".
 * @param loadB Thunk importing the same module for the second.
 * @return A tuple of two module namespaces of the same shape.
 */
export async function loadTwoBundleCopies< T >(
	loadA: () => Promise< T >,
	loadB: () => Promise< T >,
): Promise< [ T, T ] > {
	vi.resetModules();
	const bundleA = await loadA();
	vi.resetModules();
	const bundleB = await loadB();
	return [ bundleA, bundleB ];
}
