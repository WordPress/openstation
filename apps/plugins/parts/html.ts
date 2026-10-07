const ALLOWED_TAGS = new Set( [
	'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DD', 'DEL', 'DIV', 'DL', 'DT', 'EM',
	'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD',
	'LI', 'OL', 'P', 'PRE', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE',
	'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
] );

const ALLOWED_ATTRS = new Set( [
	'href', 'src', 'alt', 'title', 'name', 'rel', 'target', 'colspan', 'rowspan',
] );

const LINK_REL = 'noopener noreferrer';

export function parseHtml( html: string ): HTMLElement {
	return new DOMParser().parseFromString( `<body>${ html }</body>`, 'text/html' ).body;
}

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

export function sanitizeHtml( html: string ): string {
	const body = parseHtml( html );
	const toRemove: Element[] = [];
	for ( const el of Array.from( body.querySelectorAll( '*' ) ) ) {
		if ( ! ALLOWED_TAGS.has( el.tagName ) ) {
			toRemove.push( el );
			continue;
		}
		for ( const attr of Array.from( el.attributes ) ) {
			if ( ! ALLOWED_ATTRS.has( attr.name.toLowerCase() ) ) {
				el.removeAttribute( attr.name );
			}
		}
		for ( const urlAttr of [ 'href', 'src' ] ) {
			const value = el.getAttribute( urlAttr ) ?? '';
			if ( value && ! isSafeUrl( value ) ) {
				el.removeAttribute( urlAttr );
			}
		}
	}

	for ( const el of toRemove.reverse() ) {
		el.replaceWith( body.ownerDocument.createTextNode( el.textContent ?? '' ) );
	}
	return body.innerHTML;
}

export function stripHtml( html: string ): string {
	return html ? ( parseHtml( html ).textContent ?? '' ) : '';
}

export function escapeHtml( raw: string ): string {
	return raw
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

export function htmlBlock( html: string, className: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = className;
	wrap.innerHTML = sanitizeHtml( html );
	sanitizeLinks( wrap );
	return wrap;
}

export function sanitizeLinks( wrap: HTMLElement ): void {
	wrap.querySelectorAll( 'a' ).forEach( ( a ) => {
		a.setAttribute( 'target', '_blank' );
		a.setAttribute( 'rel', LINK_REL );
		a.setAttribute( 'data-noclick', '' );
	} );
}

export function externalLink( href: string, text: string, className = '' ): HTMLAnchorElement {
	const a = document.createElement( 'a' );
	a.href = href;
	a.target = '_blank';
	a.rel = LINK_REL;
	a.textContent = text;
	if ( className ) {
		a.className = className;
	}
	a.setAttribute( 'data-noclick', '' );
	return a;
}

export function linkButton( variant: string, label: string, href: string, size?: string ): HTMLElement {
	const btn = document.createElement( 'os-button' );
	btn.setAttribute( 'variant', variant );
	if ( size ) {
		btn.setAttribute( 'size', size );
	}
	btn.textContent = label;
	btn.setAttribute( 'data-noclick', '' );
	btn.addEventListener( 'click', () => {
		window.open( href, '_blank', LINK_REL.replace( ' ', ',' ) );
	} );
	return btn;
}

export function fallbackGlyph( className = '' ): HTMLElement {
	const span = document.createElement( 'span' );
	span.className = `dashicons dashicons-admin-plugins${ className ? ' ' + className : '' }`;
	span.setAttribute( 'aria-hidden', 'true' );
	return span;
}

export function wpOrgUrl( slug: string, hash = '' ): string {
	return `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/${ hash }`;
}
