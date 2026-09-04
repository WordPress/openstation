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
/**
 * The text a user would read, shadow DOM included.
 *
 * `textContent` stops at a shadow boundary, so an assertion against a
 * view that paints through kit components (`<os-stat>`'s value lives
 * in its shadow root) reads an empty hole where the number is. This
 * walks the COMPOSED tree instead: into shadow roots, and through
 * `<slot>`s to the light-DOM nodes they project. Components must be
 * defined (import them in the test) and their microtask render
 * flushed (`await Promise.resolve()`) before the shadow holds text.
 */
export function renderedText( node: Node ): string {
	if ( node.nodeType === Node.TEXT_NODE ) {
		return node.textContent ?? '';
	}
	if ( node instanceof Element && /^(style|script)$/i.test( node.tagName ) ) {
		// A user reads no stylesheet.
		return '';
	}
	if ( typeof HTMLSlotElement !== 'undefined' && node instanceof HTMLSlotElement ) {
		const assigned = node.assignedNodes( { flatten: true } );
		const sources = assigned.length > 0 ? assigned : Array.from( node.childNodes );
		return sources.map( renderedText ).join( '' );
	}
	if ( node instanceof Element && node.shadowRoot ) {
		// A shadow root that has not painted yet (the kit renders on a
		// microtask) would swallow the element's light children — fall
		// back to them until the shadow holds content.
		const shadowChildren = Array.from( node.shadowRoot.childNodes );
		if ( shadowChildren.length === 0 ) {
			return Array.from( node.childNodes ).map( renderedText ).join( '' );
		}
		return shadowChildren.map( renderedText ).join( '' );
	}
	return Array.from( node.childNodes ).map( renderedText ).join( '' );
}

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
		extra: {},
		windowId: 'test-window',
		loading: false,
		...seed,
	};
}
