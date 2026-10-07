import type { ViewContext } from './client';

type Seed< S, D > = Partial< ViewContext< S, D > > & {
	state: S;
	data: D;
	root: HTMLElement;
};

export function renderedText( node: Node ): string {
	if ( node.nodeType === Node.TEXT_NODE ) {
		return node.textContent ?? '';
	}
	if ( node instanceof Element && /^(style|script)$/i.test( node.tagName ) ) {
		return '';
	}
	if ( typeof HTMLSlotElement !== 'undefined' && node instanceof HTMLSlotElement ) {
		const assigned = node.assignedNodes( { flatten: true } );
		const sources = assigned.length > 0 ? assigned : Array.from( node.childNodes );
		return sources.map( renderedText ).join( '' );
	}
	if ( node instanceof Element && node.shadowRoot ) {
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
