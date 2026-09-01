/**
 * App Framework runtime — DOM morph.
 *
 * Reconciles a live subtree against freshly rendered HTML without
 * throwing the live nodes away: attributes are synced in place,
 * children are matched by `os-key` / `id` (or position when
 * unkeyed), text is updated, leftovers are removed. Custom elements
 * therefore keep their shadow roots and internal state across a
 * re-render, focus stays where the user put it, and a `<pre>` the
 * user was scrolling doesn't jump.
 *
 * Two escape hatches: `os-preserve` on an element means "mine, never
 * touch it" (a canvas a client script owns), and the focused control
 * keeps its `value` so a response that raced the keyboard can't
 * rewind what the user typed.
 *
 * @public
 */

/** Replace `parent`'s children with `html`, morphing where possible. */
export function morphChildren( parent: Element, html: string ): void {
	const template = document.createElement( 'template' );
	template.innerHTML = html;
	morphChildList( parent, Array.from( template.content.childNodes ) );
}

/** Morph one live element against a detached target element. */
export function morphElement( from: Element, to: Element ): void {
	morphNode( from, to, from.ownerDocument.activeElement );
}

function keyOf( node: Node ): string | null {
	if ( node.nodeType !== Node.ELEMENT_NODE ) {
		return null;
	}
	const el = node as Element;
	const explicit = el.getAttribute( 'os-key' );
	if ( explicit !== null && explicit !== '' ) {
		return explicit;
	}
	return el.id !== '' ? `#${ el.id }` : null;
}

function compatible( a: Node, b: Node ): boolean {
	if ( a.nodeType !== b.nodeType ) {
		return false;
	}
	if ( a.nodeType === Node.ELEMENT_NODE ) {
		return ( a as Element ).tagName === ( b as Element ).tagName;
	}
	return true;
}

function morphChildList( parent: Element, toNodes: Node[] ): void {
	const active = parent.ownerDocument.activeElement;

	const keyed = new Map< string, Node >();
	for ( const child of Array.from( parent.childNodes ) ) {
		const key = keyOf( child );
		if ( key !== null && ! keyed.has( key ) ) {
			keyed.set( key, child );
		}
	}

	let cursor = 0;
	for ( const to of toNodes ) {
		const current: Node | null = parent.childNodes[ cursor ] ?? null;
		const key = keyOf( to );
		let from: Node | null = null;

		if ( key !== null ) {
			const candidate = keyed.get( key );
			if ( candidate && compatible( candidate, to ) ) {
				from = candidate;
				// One live node per key. Without this, a view that emits
				// the same `os-key` twice would match, move and morph the
				// SAME node for both occurrences — the second render
				// silently loses a row. Spending the key here makes the
				// duplicate fall through to "insert a fresh node".
				keyed.delete( key );
				if ( candidate !== current ) {
					parent.insertBefore( candidate, current );
				}
			}
		} else if ( current && keyOf( current ) === null && compatible( current, to ) ) {
			from = current;
		}

		if ( ! from ) {
			parent.insertBefore( document.importNode( to, true ), current );
			cursor++;
			continue;
		}

		morphNode( from, to, active );
		cursor++;
	}

	while ( parent.childNodes.length > cursor ) {
		parent.removeChild( parent.childNodes[ cursor ] );
	}
}

function morphNode( from: Node, to: Node, active: Element | null ): void {
	if ( from.nodeType !== Node.ELEMENT_NODE ) {
		if ( from.nodeValue !== to.nodeValue ) {
			from.nodeValue = to.nodeValue;
		}
		return;
	}

	const fromEl = from as Element;
	const toEl = to as Element;
	if ( fromEl.hasAttribute( 'os-preserve' ) ) {
		return;
	}

	const focused = !! active && ( fromEl === active || fromEl.contains( active ) );
	syncAttributes( fromEl, toEl, focused );
	// Children first: a `<select>`'s value can only be set to an option
	// it already holds, so assigning it before the new `<option>`s are
	// morphed in makes selecting a freshly added option fail silently.
	morphChildList( fromEl, Array.from( toEl.childNodes ) );
	syncFormValue( fromEl, toEl, focused );
}

function syncAttributes( from: Element, to: Element, focused: boolean ): void {
	for ( const attr of Array.from( to.attributes ) ) {
		if ( focused && attr.name === 'value' ) {
			continue;
		}
		if ( from.getAttribute( attr.name ) !== attr.value ) {
			from.setAttribute( attr.name, attr.value );
		}
	}
	for ( const attr of Array.from( from.attributes ) ) {
		if ( to.hasAttribute( attr.name ) ) {
			continue;
		}
		if ( focused && attr.name === 'value' ) {
			continue;
		}
		from.removeAttribute( attr.name );
	}
}

/**
 * Native form controls hold their live value as a property, not the
 * attribute — mirror it, unless the user is in the control.
 */
function syncFormValue( from: Element, to: Element, focused: boolean ): void {
	if ( focused ) {
		return;
	}
	if ( from instanceof HTMLInputElement && to instanceof HTMLInputElement ) {
		if ( from.type === 'checkbox' || from.type === 'radio' ) {
			from.checked = to.checked;
		} else if ( from.value !== to.value ) {
			from.value = to.value;
		}
	} else if (
		( from instanceof HTMLTextAreaElement && to instanceof HTMLTextAreaElement ) ||
		( from instanceof HTMLSelectElement && to instanceof HTMLSelectElement )
	) {
		if ( from.value !== to.value ) {
			from.value = to.value;
		}
	}
}
