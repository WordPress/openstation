import { OS_COMPONENT_TAGS } from './tags';

const KNOWN: ReadonlySet< string > = new Set( OS_COMPONENT_TAGS );

const WARN_GRACE_MS = 2000;

const warnedTags = new Set< string >();
const observedRoots = new WeakSet< Document | ShadowRoot >();

let started = false;

function distance( a: string, b: string ): number {
	const m = a.length;
	const n = b.length;
	if ( m === 0 ) {
		return n;
	}
	if ( n === 0 ) {
		return m;
	}
	const dp: number[] = new Array( n + 1 );
	for ( let j = 0; j <= n; j++ ) {
		dp[ j ] = j;
	}
	for ( let i = 1; i <= m; i++ ) {
		let prev = dp[ 0 ];
		dp[ 0 ] = i;
		for ( let j = 1; j <= n; j++ ) {
			const tmp = dp[ j ];
			dp[ j ] = a[ i - 1 ] === b[ j - 1 ]
				? prev
				: 1 + Math.min( prev, dp[ j ], dp[ j - 1 ] );
			prev = tmp;
		}
	}
	return dp[ n ];
}

function suggest( tag: string ): string | null {
	let best: string | null = null;
	let bestD = Infinity;
	for ( const known of KNOWN ) {
		const d = distance( tag, known );
		if ( d < bestD ) {
			bestD = d;
			best = known;
		}
	}

	return bestD > 0 && bestD <= 3 ? best : null;
}

function folderFor( tag: string ): string {
	return tag.startsWith( 'os-' ) ? tag.slice( 4 ) : tag;
}

function warnFor( tag: string, sample: Element ): void {
	if ( warnedTags.has( tag ) ) {
		return;
	}
	warnedTags.add( tag );

	const isKnown = KNOWN.has( tag );

	if ( isKnown ) {
		const folder = folderFor( tag );
		console.error(
			`[wp.os] <${ tag }> is in the DOM but its module was never imported, so the tag will not upgrade and the component will render as inert HTML.\n\n` +
				`Fix — side-effect-import the component module from wherever you render it:\n\n` +
				`    import '<rel>/ui/components/${ folder }/${ folder }';\n\n` +
				`Or pull every os-* component in one go (heavier — only do this from an entry bundle):\n\n` +
				`    import '<rel>/ui/components';\n\n` +
				`See docs/components-reference.md for the full list.`,
			'\nFirst offending element:',
			sample,
		);
		return;
	}

	const guess = suggest( tag );
	if ( guess ) {
		console.error(
			`[wp.os] <${ tag }> is not a registered os-* component. Did you mean <${ guess }>?\n\n` +
				`If the typo is in your template, update it. If you meant to ship a new component, register it via 'src/ui/components/<name>/<name>.ts' and add it to 'src/ui/components/tags.ts' + 'src/ui/components/index.ts'.`,
			'\nFirst offending element:',
			sample,
		);
		return;
	}

	console.error(
		`[wp.os] <${ tag }> looks like a os-* tag but no component by that name exists.\n\n` +
			`See 'src/ui/components/index.ts' (or docs/components-reference.md) for the canonical list. If you intended to register a new component, add it to 'tags.ts' and side-effect-import its module.`,
		'\nFirst offending element:',
		sample,
	);
}

function checkElement( el: Element ): void {
	const tag = el.tagName.toLowerCase();
	if ( ! tag.startsWith( 'os-' ) ) {
		return;
	}
	if ( warnedTags.has( tag ) ) {
		return;
	}
	if ( customElements.get( tag ) ) {
		return;
	}

	let settled = false;
	customElements.whenDefined( tag ).then( () => {
		settled = true;
	} );

	setTimeout( () => {
		if ( settled ) {
			return;
		}
		if ( customElements.get( tag ) ) {
			return;
		}

		warnFor( tag, el );
	}, WARN_GRACE_MS );
}

function walk( root: Element | Document | ShadowRoot ): void {
	if ( root instanceof Element ) {
		checkElement( root );
		if ( root.shadowRoot ) {
			observeRoot( root.shadowRoot );
		}
	}
	const all = root.querySelectorAll( '*' );
	for ( let i = 0; i < all.length; i++ ) {
		const el = all[ i ];
		checkElement( el );
		if ( el.shadowRoot ) {
			observeRoot( el.shadowRoot );
		}
	}
}

function observeRoot( root: Document | ShadowRoot ): void {
	if ( observedRoots.has( root ) ) {
		return;
	}
	observedRoots.add( root );

	walk( root );

	const mo = new MutationObserver( ( records ) => {
		for ( let i = 0; i < records.length; i++ ) {
			const added = records[ i ].addedNodes;
			for ( let j = 0; j < added.length; j++ ) {
				const node = added[ j ];
				if ( node.nodeType === 1 ) {
					walk( node as Element );
				}
			}
		}
	} );
	mo.observe( root, { childList: true, subtree: true } );
}

function patchAttachShadow(): void {
	const proto = Element.prototype;
	const original = proto.attachShadow;
	if ( ( original as unknown as { __wpdPatched?: boolean } ).__wpdPatched ) {
		return;
	}
	const patched = function( this: Element, init: ShadowRootInit ): ShadowRoot {
		const root = original.call( this, init );
		if ( root.mode === 'open' ) {
			observeRoot( root );
		}
		return root;
	};
	( patched as unknown as { __wpdPatched: boolean } ).__wpdPatched = true;
	proto.attachShadow = patched;
}

export function startMissingImportWarner(): void {
	if ( started ) {
		return;
	}
	if ( typeof document === 'undefined' ) {
		return;
	}
	started = true;
	patchAttachShadow();
	observeRoot( document );
}
