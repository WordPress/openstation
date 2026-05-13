/**
 * `<wpd-*>` missing-import warner.
 *
 * A `<wpd-*>` tag that appears in the DOM without a corresponding
 * `customElements.define()` renders as an inert generic element —
 * no shadow root, no styles, no behavior, no error. That silent
 * failure is the single most common reason a developer's UI looks
 * "broken for no reason."
 *
 * This module watches the document (and every open shadow root) and
 * logs a loud, actionable `console.error` for any `wpd-*` tag that
 * never gets upgraded. Three distinct cases get three distinct
 * messages:
 *
 *  1. **Known tag, never registered** — the developer used a real
 *     component but forgot to side-effect-import its module. The
 *     warning includes the exact `import '<…>'` line to paste.
 *
 *  2. **Unknown tag, close to a known one** — likely a typo. The
 *     warning shows a "Did you mean <wpd-button>?" suggestion via
 *     Levenshtein distance against the canonical tag list.
 *
 *  3. **Unknown tag, nothing close** — invented name. The warning
 *     points the developer at the registry to discover real names.
 *
 * Race-tolerance: a tag whose definition arrives in the same task
 * (or shortly after) is NOT warned about — we wait up to
 * {@link WARN_GRACE_MS} via `customElements.whenDefined()` before
 * complaining.
 *
 * Deduping: one warning per tag for the lifetime of the page. The
 * first offending element is attached to the log so devtools can
 * jump straight to it.
 *
 * @since 0.20.0
 */

import { WPD_COMPONENT_TAGS } from './tags';

const KNOWN: ReadonlySet< string > = new Set( WPD_COMPONENT_TAGS );

/**
 * Grace period before complaining about a missing definition. Covers
 * lazy-loaded chunks and barrel imports that resolve a tick or two
 * after the element first appears. Generous on purpose: a false
 * negative (no warning when there should be one) is worse than a
 * delayed warning.
 */
const WARN_GRACE_MS = 2000;

const warnedTags = new Set< string >();
const observedRoots = new WeakSet< Document | ShadowRoot >();

let started = false;

/**
 * Levenshtein distance — small inputs, no need for the rolling-row
 * trick. Used to spot typos like `<wpd-buton>` → `<wpd-button>`.
 */
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
	// 3 edits is the practical ceiling for "did you mean" on a
	// ~15-char identifier without producing absurd suggestions.
	return bestD > 0 && bestD <= 3 ? best : null;
}

function folderFor( tag: string ): string {
	// `wpd-context-menu-option` lives inside `wpd-context-menu/`;
	// `wpd-segment` inside `wpd-segmented/`; etc. We can't always
	// derive the folder from the tag, so for known compound tags we
	// fall back to a best-effort suggestion and let the developer
	// correct the path. The barrel import is always safe.
	return tag.startsWith( 'wpd-' ) ? tag.slice( 4 ) : tag;
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
			`[wp.desktop] <${ tag }> is in the DOM but its module was never imported, so the tag will not upgrade and the component will render as inert HTML.\n\n` +
				`Fix — side-effect-import the component module from wherever you render it:\n\n` +
				`    import '<rel>/ui/components/${ folder }/${ folder }';\n\n` +
				`Or pull every wpd-* component in one go (heavier — only do this from an entry bundle):\n\n` +
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
			`[wp.desktop] <${ tag }> is not a registered wpd-* component. Did you mean <${ guess }>?\n\n` +
				`If the typo is in your template, update it. If you meant to ship a new component, register it via 'src/ui/components/<name>/<name>.ts' and add it to 'src/ui/components/tags.ts' + 'src/ui/components/index.ts'.`,
			'\nFirst offending element:',
			sample,
		);
		return;
	}

	console.error(
		`[wp.desktop] <${ tag }> looks like a wpd-* tag but no component by that name exists.\n\n` +
			`See 'src/ui/components/index.ts' (or docs/components-reference.md) for the canonical list. If you intended to register a new component, add it to 'tags.ts' and side-effect-import its module.`,
		'\nFirst offending element:',
		sample,
	);
}

/**
 * Check a single element. Fast path first: skip non-wpd, skip
 * already-warned tags, skip already-defined tags. Otherwise wait
 * out the grace period and warn if still undefined.
 */
function checkElement( el: Element ): void {
	const tag = el.tagName.toLowerCase();
	if ( ! tag.startsWith( 'wpd-' ) ) {
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
		// `el` may have been removed by now; that's fine — keeping a
		// reference in the console still lets devs inspect what was
		// originally rendered.
		warnFor( tag, el );
	}, WARN_GRACE_MS );
}

/**
 * Walk an element subtree, checking every descendant and recursing
 * into any open shadow roots encountered along the way.
 */
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
				if ( node.nodeType === 1 /* ELEMENT_NODE */ ) {
					walk( node as Element );
				}
			}
		}
	} );
	mo.observe( root, { childList: true, subtree: true } );
}

/**
 * Patch `Element.prototype.attachShadow` so we can observe shadow
 * roots created after startup. Only open roots are observable from
 * outside — closed roots are opaque by design, and we accept that
 * gap. The patch is installed once and is idempotent.
 */
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

/**
 * Start the warner. Idempotent — calling more than once is a no-op.
 * Safe to call at any time; if the document is still parsing, the
 * MutationObserver will pick up the rest as it arrives.
 *
 * @since 0.20.0
 */
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
