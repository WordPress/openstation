/**
 * Plugins app — wp.org HTML, made safe.
 *
 * Part of the `desktop-mode-plugins` client view. wp.org returns
 * HTML strings (descriptions, changelogs, FAQs, screenshot captions);
 * the detail panel and the flyout both inject them, so one allow-list
 * serves both: scripts, iframes and event handlers stripped; headings,
 * paragraphs, lists, links, images and code kept; link and image URLs
 * must pass {@link isSafeUrl} or the attribute goes.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';

const ALLOWED_TAGS = new Set( [
	'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DD', 'DEL', 'DIV', 'DL', 'DT', 'EM',
	'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD',
	'LI', 'OL', 'P', 'PRE', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE',
	'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
] );

const ALLOWED_ATTRS = new Set( [
	'href', 'src', 'alt', 'title', 'name', 'rel', 'target', 'colspan', 'rowspan',
] );

/**
 * True when the URL carries no scheme (relative) or an allow-listed
 * one. Browsers strip control characters and whitespace before
 * resolving, so `java\tscript:` reaches the engine as `javascript:` —
 * normalise the same way before reading the scheme.
 */
export function isSafeUrl( raw: string ): boolean {
	const cleaned = Array.from( raw )
		.filter( ( ch ) => ch.charCodeAt( 0 ) > 0x20 )
		.join( '' )
		.toLowerCase();
	const scheme = cleaned.match( /^([a-z][a-z0-9+.-]*):/ );
	if ( ! scheme ) {
		return true;
	}
	return [ 'http', 'https', 'mailto', 'tel' ].includes( scheme[ 1 ] );
}

/** The permissive allow-list. Disallowed elements collapse to their text. */
export function sanitizeHtml( html: string ): string {
	const wrap = document.createElement( 'div' );
	wrap.innerHTML = html;
	const walker = document.createTreeWalker( wrap, NodeFilter.SHOW_ELEMENT );
	const toRemove: Element[] = [];
	let current: Element | null = walker.currentNode as Element;
	while ( current ) {
		const next = walker.nextNode() as Element | null;
		if ( current !== wrap ) {
			if ( ! ALLOWED_TAGS.has( current.tagName ) ) {
				toRemove.push( current );
			} else {
				for ( const attr of Array.from( current.attributes ) ) {
					if ( ! ALLOWED_ATTRS.has( attr.name.toLowerCase() ) ) {
						current.removeAttribute( attr.name );
					}
				}
				for ( const urlAttr of [ 'href', 'src' ] ) {
					const value = current.getAttribute( urlAttr ) ?? '';
					if ( value && ! isSafeUrl( value ) ) {
						current.removeAttribute( urlAttr );
					}
				}
			}
		}
		current = next;
	}
	for ( const el of toRemove ) {
		el.replaceWith( document.createTextNode( el.textContent ?? '' ) );
	}
	return wrap.innerHTML;
}

/** Every link opens in a new tab and never fires the table's row click. */
export function sanitizeLinks( wrap: HTMLElement, rel = 'noopener noreferrer' ): void {
	wrap.querySelectorAll( 'a' ).forEach( ( a ) => {
		a.setAttribute( 'target', '_blank' );
		a.setAttribute( 'rel', rel );
		a.setAttribute( 'data-noclick', '' );
	} );
}

/** A `YYYY-MM-DD…` string as the user's locale date; anything else verbatim. */
export function humanDate( raw: string | undefined ): string {
	if ( ! raw ) {
		return '—';
	}
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec( raw );
	if ( ! m ) {
		return raw;
	}
	try {
		return new Date( Date.UTC( +m[ 1 ], +m[ 2 ] - 1, +m[ 3 ] ) ).toLocaleDateString();
	} catch {
		return raw;
	}
}

/** Kilobytes as "12 KB" / "1.4 MB"; `—` when unknown. */
export function formatSize( kb: number | null | undefined ): string {
	if ( kb === null || kb === undefined ) {
		return '—';
	}
	if ( kb < 1024 ) {
		return sprintf(
			/* translators: %d: size in kilobytes */
			__( '%d KB', 'desktop-mode' ),
			kb,
		);
	}
	return sprintf(
		/* translators: %s: size in megabytes (one decimal) */
		__( '%s MB', 'desktop-mode' ),
		( kb / 1024 ).toFixed( 1 ),
	);
}

/** An `<os-button>` that opens `href` in a new tab. */
export function linkButton( variant: string, label: string, href: string, size?: string ): HTMLElement {
	const btn = document.createElement( 'os-button' );
	btn.setAttribute( 'variant', variant );
	if ( size ) {
		btn.setAttribute( 'size', size );
	}
	btn.textContent = label;
	btn.setAttribute( 'data-noclick', '' );
	btn.addEventListener( 'click', () => {
		window.open( href, '_blank', 'noopener,noreferrer' );
	} );
	return btn;
}
