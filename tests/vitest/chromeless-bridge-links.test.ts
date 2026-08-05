/**
 * The chromeless bridge's link interceptor, run against a real DOM.
 *
 * The interceptor is JavaScript emitted from a PHP heredoc, so the
 * PHP suite can only assert that source strings appear in the right
 * order. That pins the text and not the behaviour, which is how two
 * separate regressions of the same shape both shipped: the
 * capture-phase handler beating the script that owns a link, and the
 * `_wp_http_referer` stamp going missing once we started yielding.
 *
 * So: pull the emitted script straight out of the PHP, run it in
 * jsdom, click real anchors, and assert what the parent shell
 * actually receives.
 *
 * Three outcomes are possible for a click, and every anchor below
 * pins one of them:
 *
 *   1. Handed to the shell, via `preventDefault()` plus an
 *      `os-iframe-admin-link` message. The default for admin links.
 *   2. Yielded untouched, because some in-page script owns the click.
 *   3. Yielded with the href stamped, because nothing owns the click,
 *      so the href IS the navigation and it needs the referer hint
 *      the parent can no longer add on our behalf.
 *
 * @vitest-environment-options { "url": "http://localhost/wp-admin/upload.php?openstation_chromeless=1" }
 */
import { describe, expect, test, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

/** Messages the bridge posted to the (stubbed) parent shell. */
let posted: Array< Record< string, unknown > > = [];

/**
 * The bridge script exactly as `openstation_chromeless_bridge_script()`
 * prints it, with the four server-substituted placeholders resolved to
 * the values PHP uses when a page carries no payload.
 */
function emittedBridgeScript(): string {
	const php = readFileSync(
		resolve( ROOT, 'includes/render/chromeless-bridge.php' ),
		'utf8'
	);
	const match = /\$js = <<<'JS'\n([\s\S]*?)\nJS;/.exec( php );
	if ( ! match ) {
		throw new Error(
			'Could not find the bridge heredoc in chromeless-bridge.php.'
		);
	}
	return match[ 1 ]
		.replace( '/*__OPENSTATION_MENU_PAYLOAD__*/', 'null' )
		.replace( '/*__OPENSTATION_MENU_SIG__*/', 'null' )
		.replace( '/*__OPENSTATION_CONTENT_IDENTITY__*/', 'null' )
		.replace( '/*__OPENSTATION_SOFT_RELOAD_EXTRAS__*/', '[]' );
}

beforeAll( () => {
	// The script's first act is an escape hatch: a chromeless page
	// that is its own top window strips the flag and reloads as
	// classic admin. jsdom's `window.parent` IS `window`, so stub it
	// before running anything.
	Object.defineProperty( window, 'parent', {
		value: {
			postMessage: ( data: Record< string, unknown > ) => {
				posted.push( data );
			},
		},
		configurable: true,
	} );

	// eslint-disable-next-line no-eval -- the point is to exercise the
	// emitted source rather than a re-implementation of it.
	( 0, eval )( emittedBridgeScript() );

	// Stands in for whatever in-page script owns a yielded click, and
	// keeps jsdom from logging "navigation not implemented" for the
	// anchors the bridge deliberately lets through. Bubble phase, so
	// it always runs after the interceptor.
	document.addEventListener( 'click', ( e ) => e.preventDefault() );
} );

beforeEach( () => {
	posted = [];
	document.body.innerHTML = '';
} );

/** Appends an anchor and clicks it. Returns its href afterwards. */
function clickLink( html: string ): string {
	document.body.innerHTML = html;
	const link = document.querySelector( 'a' ) as HTMLAnchorElement;
	link.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, cancelable: true } )
	);
	return link.getAttribute( 'href' ) ?? '';
}

/** The admin-link messages the bridge sent for the last click. */
function adminLinkMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-iframe-admin-link' );
}

/** The `_wp_http_referer` an href carries, or null. */
function referer( href: string ): string | null {
	return new URL( href, window.location.href ).searchParams.get(
		'_wp_http_referer'
	);
}

describe( 'chromeless bridge: which clicks reach the shell', () => {
	test( 'a plain admin link is handed to the shell', () => {
		clickLink( '<a href="/wp-admin/edit.php">Posts</a>' );

		expect( adminLinkMessages() ).toHaveLength( 1 );
		expect( adminLinkMessages()[ 0 ].url ).toContain( '/wp-admin/edit.php' );
	} );

	test( 'core JS buttons are yielded to the script that owns them', () => {
		// `upload.php`'s Add Media File: media-grid.js turns this into
		// an inline uploader toggle and the href is its no-JS fallback.
		// Hijacking it opened a second window on top of the uploader.
		clickLink(
			'<a href="/wp-admin/media-new.php" class="page-title-action aria-button-if-js">Add Media File</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	test( 'core AJAX buttons stay with updates.js', () => {
		clickLink(
			'<a href="/wp-admin/update.php?action=install-plugin&plugin=x" class="install-now">Install Now</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );
} );

describe( 'chromeless bridge: the referer stamp on unowned links', () => {
	// The Media list table stamps `aria-button-if-js` on its row
	// actions but binds no handler, so these navigate for real. The
	// parent used to stamp `_wp_http_referer` on them via its
	// destructive-action path; now that it never sees the click, the
	// interceptor has to. Without the hint, a `Referrer-Policy` of
	// `strict-origin` or tighter leaves `post.php` with a bare origin
	// as its referer, and the window lands on the site front page
	// instead of back on the media list.
	const DELETE_LINK =
		'<a href="/wp-admin/post.php?action=delete&post=7&_wpnonce=abc" class="submitdelete aria-button-if-js">Delete Permanently</a>';

	test( 'the href gains the source page as _wp_http_referer', () => {
		const href = clickLink( DELETE_LINK );

		expect( adminLinkMessages() ).toHaveLength( 0 );
		expect( referer( href ) ).toBe( '/wp-admin/upload.php' );
	} );

	test( 'the hint drops the chromeless flag it inherits from this page', () => {
		// This page is `upload.php?openstation_chromeless=1`. WP feeds
		// `wp_get_referer()` into the redirect it builds next, so the
		// flag must not ride along into it.
		const href = clickLink( DELETE_LINK );

		expect( referer( href ) ).not.toContain( 'openstation_chromeless' );
	} );

	test( 'a referer already in the markup is never overwritten', () => {
		const href = clickLink(
			'<a href="/wp-admin/post.php?action=delete&post=7&_wpnonce=abc&_wp_http_referer=%2Fwp-admin%2Fedit.php" class="submitdelete aria-button-if-js">Delete</a>'
		);

		expect( referer( href ) ).toBe( '/wp-admin/edit.php' );
	} );

	test( 'destructive links without the class still go to the shell', () => {
		// The posts list table's Trash carries `submitdelete` but no
		// `aria-button-if-js`, so it keeps the parent-side path where
		// the shell does its own stamping. Guards against widening the
		// bail past the links that actually need it.
		clickLink(
			'<a href="/wp-admin/post.php?action=trash&post=7&_wpnonce=abc" class="submitdelete">Trash</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 1 );
	} );

	test( 'owned JS buttons are not stamped', () => {
		// wp-lists builds its AJAX payload out of the href, so an
		// extra param would ride along into the request.
		const href = clickLink(
			'<a href="/wp-admin/comment.php?action=unapprovecomment&c=3&_wpnonce=abc" class="vim-u aria-button-if-js" data-wp-lists="dim:the-comment-list:comment-3">Unapprove</a>'
		);

		expect( href ).not.toContain( '_wp_http_referer' );
	} );
} );
