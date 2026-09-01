/**
 * App Framework — test doubles.
 *
 * Not part of any bundle: app test suites import this directly to
 * build a {@link ViewContext} without hand-writing the framework's
 * members — which is how four suites ended up with four drifting
 * context stubs. `state`, `data` and `root` are the test's to
 * provide; everything else defaults to an inert double that still
 * honours the contract (`ui` really memoises, `fetch` really goes
 * through `globalThis.fetch` so a `vi.stubGlobal( 'fetch', … )`
 * still intercepts it).
 *
 * @public
 */

import type { ViewContext } from './client';

/** The members a test must provide; the rest default. */
type Seed< S, D > = Partial< ViewContext< S, D > > & {
	state: S;
	data: D;
	root: HTMLElement;
};

/**
 * A complete, mutable {@link ViewContext} for a test. Override any
 * member via the seed; assign `ctx.repaint` after creation when the
 * test wants a repaint to actually re-render.
 */
export function mockViewContext< S extends Record< string, unknown >, D >(
	seed: Seed< S, D >,
): ViewContext< S, D > {
	let bag: unknown;
	return {
		dispatch: async () => true,
		local: () => undefined,
		ui: < T >( factory: () => T ): T => {
			if ( bag === undefined ) {
				bag = factory();
			}
			return bag as T;
		},
		repaint: () => undefined,
		fetch: ( input, init ) => globalThis.fetch( input, init ),
		host: {
			fetch: ( input, init ) => globalThis.fetch( input, init ),
		},
		...seed,
	};
}
