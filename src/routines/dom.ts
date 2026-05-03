/**
 * Routines — small DOM helpers.
 *
 * Shared between the canvas, the inspector, and the picker. Tiny on
 * purpose — anything bigger lives in its own module so the bundle
 * stays scannable.
 *
 * @since 0.22.0
 */

/**
 * Typed `document.createElement` shorthand.
 *
 * Accepts a `class` shorthand (the underlying HTMLElement uses
 * `className`, but `class` reads more like the markup we're
 * mirroring) and a `dataset` map. Children may be DOM nodes or
 * strings — strings get appended as text nodes by `append`, so
 * they're already escape-safe.
 */
export function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	props: Partial< HTMLElementTagNameMap[ K ] > & {
		class?: string;
		dataset?: Record< string, string >;
	} = {},
	children: ( Node | string )[] = [],
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	const { class: className, dataset, ...rest } = props as Record< string, unknown > & {
		class?: string;
		dataset?: Record< string, string >;
	};
	if ( className ) {
		node.className = className;
	}
	if ( dataset ) {
		for ( const [ k, v ] of Object.entries( dataset ) ) {
			node.dataset[ k ] = v;
		}
	}
	Object.assign( node, rest );
	for ( const child of children ) {
		node.append( child );
	}
	return node;
}

/**
 * Open an overlay dialog rooted at the body element. The caller
 * gets the card to populate; clicking the backdrop or pressing
 * Escape closes the dialog.
 *
 * @param body  Window body to mount the overlay into.
 * @param title Heading text.
 * @return The card element + a close() handle.
 */
export function openModal(
	body: HTMLElement,
	title: string,
): { card: HTMLElement; close: () => void } {
	const overlay = el( 'div', { class: 'wpdm-routines__modal' } );
	const card = el( 'div', { class: 'wpdm-routines__modal-card' } );
	const heading = el( 'h3', { class: 'wpdm-routines__modal-heading' } );
	heading.textContent = title;
	card.append( heading );
	overlay.append( card );

	const close = (): void => {
		overlay.remove();
		document.removeEventListener( 'keydown', onKey );
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			close();
		}
	};
	overlay.addEventListener( 'click', ( ev ) => {
		if ( ev.target === overlay ) {
			close();
		}
	} );
	document.addEventListener( 'keydown', onKey );

	body.append( overlay );
	return { card, close };
}

/**
 * Group an array of records by a string key, preserving original
 * order within each bucket.
 */
export function groupBy< T >(
	items: T[],
	key: keyof T,
): Map< string, T[] > {
	const out = new Map< string, T[] >();
	for ( const item of items ) {
		const raw = ( item as Record< string, unknown > )[ String( key ) ];
		const k = String( raw ?? '' ) || '—';
		const bucket = out.get( k );
		if ( bucket ) {
			bucket.push( item );
		} else {
			out.set( k, [ item ] );
		}
	}
	return out;
}

/**
 * Walk a payload schema's flat dotted keys (`comment.content`,
 * `order.total`) into the suggestion list the autocomplete uses.
 *
 * @param schema Trigger payload_schema record.
 * @return Suggestion entries `{ path, type, description }`.
 */
export function flattenSchema(
	schema: Record< string, unknown >,
): Array< { path: string; type: string; description: string } > {
	const out: Array< { path: string; type: string; description: string } > = [];
	for ( const [ path, descriptor ] of Object.entries( schema ) ) {
		if ( descriptor && typeof descriptor === 'object' ) {
			const d = descriptor as { type?: unknown; description?: unknown };
			out.push( {
				path,
				type: typeof d.type === 'string' ? d.type : 'unknown',
				description:
					typeof d.description === 'string' ? d.description : '',
			} );
			continue;
		}
		out.push( { path, type: 'unknown', description: '' } );
	}
	return out;
}
