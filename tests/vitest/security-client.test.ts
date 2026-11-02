/**
 * Client-side security regressions.
 *
 * Two kinds of test live here:
 *
 *   1. Holes that were closed: bypasses of the shell's own sanitisers
 *      — `sanitizeIconSvg()` (SVG icons that reach `innerHTML`) and
 *      the Gutenberg drop receiver's URL gate (hrefs that reach post
 *      content) — and the shared-folder placement `meta` a
 *      collaborator can write, whose `iconUrl` made every member's
 *      browser fetch a URL of the collaborator's choosing. Each failed
 *      before its fix.
 *   2. Invariants the audit confirmed hold, pinned so a refactor that
 *      quietly drops one fails here instead of shipping: the Markdown
 *      renderer's escaping and scheme filter, the same-origin gate on
 *      every iframe window URL, and the window message handler's
 *      origin + source checks.
 */
import { describe, expect, test } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { sanitizeIconSvg } from '../../src/utils';
import { buildBlockSpec } from '../../src/gutenberg-drop-receiver';
import { renderMarkdown } from '../../src/markdown';
import { withChromelessParam } from '../../src/window/dom';
import { sanitizeHtml } from '../../apps/plugins/parts/html';
import { placementIconOverride, placementLabel } from '../../src/desktop-files/file-tile';
import type { RestPlacementShape } from '../../src/desktop-files/rest';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

/** Every attribute value in a sanitised SVG, as the browser would resolve it. */
function attributeValues( markup: string ): string[] {
	const doc = new DOMParser().parseFromString( markup, 'image/svg+xml' );
	const values: string[] = [];
	for ( const el of Array.from( doc.querySelectorAll( '*' ) ) ) {
		for ( const attr of Array.from( el.attributes ) ) {
			// URL parsers drop ASCII whitespace and C0 controls, so
			// compare the way the navigation would see it.
			values.push( Array.from( attr.value ).filter( ( ch ) => ch.charCodeAt( 0 ) > 0x20 ).join( '' ).toLowerCase() );
		}
	}
	return values;
}

describe( 'sanitizeIconSvg — javascript: URLs cannot survive', () => {
	test( 'a tab entity inside the scheme is still caught', () => {
		const out = sanitizeIconSvg(
			`<svg ${ SVG_NS }><a href="java&#9;script:alert(1)"><path d="M0 0h1"/></a></svg>`,
		);
		expect( attributeValues( out ).some( ( v ) => v.includes( 'javascript:' ) ) ).toBe( false );
		expect( out ).toContain( '<path' );
	} );

	test( 'a leading newline / NUL before the scheme is still caught', () => {
		const out = sanitizeIconSvg(
			`<svg ${ SVG_NS } xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&#10;javascript:alert(1)"><path d="M0 0h1"/></a></svg>`,
		);
		expect( attributeValues( out ).some( ( v ) => v.includes( 'javascript:' ) ) ).toBe( false );
	} );

	test( 'a SMIL animation cannot rewrite an href to javascript: at runtime', () => {
		const out = sanitizeIconSvg(
			`<svg ${ SVG_NS }><a><animate attributeName="href" values="x;javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/><path d="M0 0h1"/></a></svg>`,
		);
		expect( out.toLowerCase() ).not.toContain( '<animate' );
		expect( out.toLowerCase() ).not.toContain( '<set' );
		expect( out ).not.toContain( 'alert' );
		expect( out ).toContain( '<path' );
	} );

	test( 'ordinary icon markup is untouched', () => {
		const input = `<svg ${ SVG_NS } viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z" fill="currentColor"/></svg>`;
		const out = sanitizeIconSvg( input );
		expect( out ).toContain( 'viewBox="0 0 24 24"' );
		expect( out ).toContain( 'fill="currentColor"' );
	} );
} );

describe( 'buildBlockSpec — dangerous schemes are refused however they are spelled', () => {
	const hostile = [
		'javascript:alert(1)',
		' javascript:alert(1)',
		'java\tscript:alert(1)',
		'java\nscript:alert(1)',
		'\u0000javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'd\tata:text/html,x',
		'vb\rscript:msgbox(1)',
	];

	for ( const url of hostile ) {
		test( `post link ${ JSON.stringify( url ) } inserts nothing`, () => {
			expect( buildBlockSpec( { kind: 'post', id: 1, url, title: 'x' } ) ).toBeNull();
		} );
		test( `attachment ${ JSON.stringify( url ) } inserts nothing`, () => {
			expect(
				buildBlockSpec( { kind: 'attachment', id: 1, url, title: 'x', alt: '', mime: 'application/pdf' } ),
			).toBeNull();
		} );
	}

	test( 'ordinary http(s) and relative links still insert', () => {
		expect( buildBlockSpec( { kind: 'post', id: 1, url: 'https://example.test/?p=1', title: 'A' } ) ).not.toBeNull();
		expect( buildBlockSpec( { kind: 'post', id: 1, url: '/?p=1', title: 'A' } ) ).not.toBeNull();
	} );

	test( 'a post title is escaped into the paragraph markup', () => {
		const spec = buildBlockSpec( { kind: 'post', id: 1, url: 'https://example.test/?p=1', title: '<img src=x onerror=alert(1)>' } );
		expect( String( spec?.attributes.content ) ).not.toContain( '<img' );
	} );
} );

describe( 'renderMarkdown — note, agent and AI text stays inert', () => {
	test( 'raw HTML is escaped, not rendered', () => {
		const out = renderMarkdown( '<img src=x onerror=alert(1)> **bold**' );
		expect( out ).not.toContain( '<img' );
		expect( out ).toContain( '&lt;img' );
		expect( out ).toContain( '<strong>bold</strong>' );
	} );

	test( 'only http(s) links become anchors', () => {
		expect( renderMarkdown( '[x](javascript:alert(1))' ) ).not.toContain( '<a' );
		expect( renderMarkdown( '[x](data:text/html,hi)' ) ).not.toContain( '<a' );
		expect( renderMarkdown( '[x](https://example.test/)' ) ).toContain( '<a href="https://example.test/"' );
	} );

	test( 'a quote in a link URL cannot break out of the href', () => {
		const out = renderMarkdown( '[x](https://example.test/"onmouseover="alert(1))' );
		const host = document.createElement( 'div' );
		const doc = new DOMParser().parseFromString( out, 'text/html' );
		host.append( ...Array.from( doc.body.childNodes ) );
		for ( const el of Array.from( host.querySelectorAll( '*' ) ) ) {
			expect( el.getAttributeNames().filter( ( n ) => n.startsWith( 'on' ) ) ).toEqual( [] );
		}
	} );
} );

describe( 'withChromelessParam — iframe windows only ever load same-origin URLs', () => {
	test( 'script and data schemes are refused', () => {
		expect( withChromelessParam( 'javascript:alert(1)' ) ).toBeNull();
		expect( withChromelessParam( 'data:text/html,<script>alert(1)</script>' ) ).toBeNull();
	} );

	test( 'cross-origin URLs are refused', () => {
		expect( withChromelessParam( 'https://evil.example/wp-admin/' ) ).toBeNull();
		expect( withChromelessParam( '//evil.example/wp-admin/' ) ).toBeNull();
	} );

	test( 'a same-origin admin URL gets the chromeless flag', () => {
		const out = withChromelessParam( '/wp-admin/edit.php' );
		expect( out ).not.toBeNull();
		expect( new URL( out as string ).origin ).toBe( window.location.origin );
	} );
} );

describe( 'sanitizeHtml (wp.org readme / review HTML) — handlers and script URLs go', () => {
	test( 'event handlers and javascript: hrefs are stripped', () => {
		const out = sanitizeHtml( '<p onclick="alert(1)">a</p><a href="java\tscript:alert(1)">b</a><img src=x onerror=alert(1)>' );
		expect( out ).not.toMatch( /onclick|onerror|javascript/i );
	} );

	test( 'disallowed elements collapse to text', () => {
		const out = sanitizeHtml( '<svg><a href="javascript:alert(1)">x</a></svg><script>alert(1)</script>' );
		expect( out ).not.toMatch( /<svg|<script|href/i );
	} );
} );

/** A placement carrying `meta`, as a shared-folder collaborator could write it. */
function placementWithMeta( meta: unknown ): RestPlacementShape {
	return {
		id: 7,
		parentId: 3,
		x: 0,
		y: 0,
		sortOrder: 0,
		updatedAtMs: 1,
		meta,
		file: {
			type: 'link',
			ref: 'https://example.test/',
			title: 'Owner title',
			icon: 'dashicons-admin-links',
			previewUrl: '',
			exists: true,
		},
	} as unknown as RestPlacementShape;
}

describe( 'placement meta — collaborator-written, painted for every member', () => {
	test( 'a remote meta.iconUrl is refused (no third-party beacon per member)', () => {
		expect( placementIconOverride( placementWithMeta( { iconUrl: 'https://tracker.example/p.gif?u=1' } ) ) ).toBe( '' );
		expect( placementIconOverride( placementWithMeta( { iconUrl: '//tracker.example/p.gif' } ) ) ).toBe( '' );
	} );

	test( 'script / non-image schemes are refused', () => {
		for ( const iconUrl of [ 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x' ] ) {
			expect( placementIconOverride( placementWithMeta( { iconUrl } ) ) ).toBe( '' );
		}
	} );

	test( 'a dashicon override cannot smuggle extra classes', () => {
		expect( placementIconOverride( placementWithMeta( { iconUrl: 'dashicons-star-filled os-window--fullscreen' } ) ) ).toBe( '' );
		expect( placementIconOverride( placementWithMeta( { iconUrl: 'dashicons-star-filled' } ) ) ).toBe( 'dashicons-star-filled' );
	} );

	test( 'the favicon resolver\'s data: URI and same-origin images still paint', () => {
		const png = 'data:image/png;base64,iVBORw0KGgo=';
		expect( placementIconOverride( placementWithMeta( { iconUrl: png } ) ) ).toBe( png );
		const local = `${ window.location.origin }/wp-content/uploads/icon.png`;
		expect( placementIconOverride( placementWithMeta( { iconUrl: local } ) ) ).toBe( local );
	} );

	test( 'non-string meta values are ignored, not thrown on', () => {
		expect( placementIconOverride( placementWithMeta( { iconUrl: { toString: 'x' } } ) ) ).toBe( '' );
		expect( placementIconOverride( placementWithMeta( null ) ) ).toBe( '' );
		expect( placementLabel( placementWithMeta( { name: 42 } ) ) ).toBe( 'Owner title' );
	} );

	test( 'meta.name reaches the tile as text, never markup', async () => {
		installHooksStub();
		try {
			const { buildTile } = await import( '../../src/desktop-files/file-tile' );
			const tile = buildTile( placementWithMeta( { name: '<img src=x onerror=alert(1)>' } ), 3 );
			document.body.appendChild( tile );
			await Promise.resolve();
			expect( tile.querySelector( 'img[onerror]' ) ).toBeNull();
			expect( tile.getAttribute( 'label' ) ).toBe( '<img src=x onerror=alert(1)>' );
			tile.remove();
		} finally {
			clearHooksStub();
		}
	} );
} );
