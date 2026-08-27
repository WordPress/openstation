/**
 * The chromeless bridge's link and form interceptors, run against a
 * real DOM — one pair of listeners in the source, one file here.
 *
 * The interceptor runs in a document PHPUnit never loads, so the PHP
 * suite can only assert that source strings appear in the right
 * order. That pins the text and not the behaviour, which is how two
 * separate regressions of the same shape both shipped: the
 * capture-phase handler beating the script that owns a link, and the
 * `_wp_http_referer` stamp going missing once we started yielding.
 *
 * So: load the bridge source, run it in jsdom, click real anchors,
 * and assert what the parent shell actually receives.
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
 * The bridge source, read from the file that builds into the bundle
 * every window loads.
 *
 * This used to slice the script out of a nowdoc in
 * `chromeless-bridge.php` and resolve four `str_replace` placeholders
 * by hand. The bridge now lives in `src/chromeless-bridge.js` and
 * takes its per-request values off `window.__osChromelessData`, so the
 * test seeds that global instead — the same shape PHP emits as an
 * inline `before` block, with the values a page carrying no payload
 * gets.
 */
function emittedBridgeScript(): string {
	return readFileSync(
		resolve( ROOT, 'src/chromeless-bridge.js' ),
		'utf8'
	);
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

	// The per-request block PHP prints ahead of the bundle. Values are
	// what a page with no menu payload gets.
	(
		window as unknown as { __osChromelessData: Record< string, unknown > }
	).__osChromelessData = {
		_menuPayload: null,
		_menuSig: null,
		_identity: null,
		_softReload: [],
	};

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

/** Appends a form and submits it. */
function submitForm(
	html: string,
	onForm?: ( form: HTMLFormElement ) => void
): void {
	document.body.innerHTML = html;
	const form = document.querySelector( 'form' ) as HTMLFormElement;
	onForm?.( form );
	form.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );
}

/** The activity messages the bridge sent for the last submit. */
function activityMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-iframe-activity' );
}

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

	// `plugin-install.php`'s Upload Plugin. Core binds a bubble-phase
	// toggle that opens the drop zone in place above the plugin cards,
	// but stamps no `aria-button-if-js`, so we used to win the click
	// and navigate to `?tab=upload` — a page showing the uploader with
	// no cards and no way back.
	test( 'the Upload Plugin toggle stays with plugin-install.js', () => {
		clickLink(
			'<div class="wrap plugin-install-tab-featured">' +
				'<a href="/wp-admin/plugin-install.php?tab=upload" class="upload-view-toggle page-title-action">Upload Plugin</a>' +
				'</div>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	// The Dashboard's welcome panel. dashboard.js binds the dismiss on
	// the anchor itself, and `?welcome=0` is a no-JS fallback nothing
	// in core reads any more — routing it opened a second Dashboard
	// window, titled "Dismiss", on top of the one being dismissed.
	test( 'the welcome panel dismiss links stay with dashboard.js', () => {
		clickLink(
			'<div id="welcome-panel"><a class="welcome-panel-close" href="/wp-admin/?welcome=0" aria-label="Dismiss the welcome panel">Dismiss</a></div>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );

		clickLink(
			'<div id="welcome-panel"><p class="welcome-panel-dismiss"><a href="/wp-admin/?welcome=0">Dismiss</a></p></div>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	// On `?tab=upload` core skips that binding on purpose ("let the
	// link behave like a link"), so the href IS the navigation and the
	// shell has to route it like any other admin link.
	test( 'the same toggle is handed to the shell on the upload page', () => {
		clickLink(
			'<div class="wrap plugin-install-tab-upload">' +
				'<a href="/wp-admin/plugin-install.php" class="upload-view-toggle page-title-action">Browse Plugins</a>' +
				'</div>'
		);

		expect( adminLinkMessages() ).toHaveLength( 1 );
		expect( adminLinkMessages()[ 0 ].url ).toContain(
			'/wp-admin/plugin-install.php'
		);
	} );
} );

describe( 'chromeless bridge: the label a link ships to the shell', () => {
	/** The `label` on the last admin-link message. */
	function label(): unknown {
		return adminLinkMessages()[ 0 ]?.label;
	}

	test( 'screen-reader text is not part of the visible label', () => {
		// The classic editor's revisions link pairs a terse visible
		// word with a fuller screen-reader one, and `textContent` reads
		// back as both — the window came out titled "Browse Browse
		// revisions".
		clickLink(
			'<a href="/wp-admin/revision.php?revision=24"><span aria-hidden="true">Browse</span> <span class="screen-reader-text">Browse revisions</span></a>'
		);

		expect( label() ).toBe( 'Browse' );
	} );

	test( 'the markup’s indentation whitespace is collapsed', () => {
		clickLink(
			'<a href="/wp-admin/edit.php">\n\t\t\tAll\n\t\t\tPosts\n\t\t</a>'
		);

		expect( label() ).toBe( 'All Posts' );
	} );

	test( 'a link with nothing but screen-reader text falls back to its title', () => {
		clickLink(
			'<a href="/wp-admin/edit.php" title="Posts"><span class="screen-reader-text">Go to posts</span></a>'
		);

		expect( label() ).toBe( 'Posts' );
	} );
} );

describe( 'chromeless bridge: links that name another browsing context', () => {
	// The block editor's revisions sidebar renders "Open classic
	// revisions screen" through `<ExternalLink>`, which hard-codes
	// `target="_blank"`. Yielding on it threw the user out of the
	// shell into a chrome-free wp-admin tab — and under the PWA that
	// tab is inside the app's own scope, so the click relaunched the
	// whole app. A `_blank` on an admin URL means "without losing the
	// page I am on", which the shell answers with another window.
	test( 'a _blank admin link is claimed for a desktop window', () => {
		clickLink(
			'<a href="/wp-admin/revision.php?revision=24" target="_blank" rel="external noopener">Open classic revisions screen</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 1 );
		expect( adminLinkMessages()[ 0 ].url ).toContain(
			'/wp-admin/revision.php'
		);
		expect( adminLinkMessages()[ 0 ].url ).toContain( 'revision=24' );
		// Tells the parent it may not drive THIS window with it.
		expect( adminLinkMessages()[ 0 ].newContext ).toBe( true );
	} );

	test( 'a _blank to another view of the same admin file is left to the browser', () => {
		// This page is `upload.php`. Whether two URLs on one file are
		// the same "page" is a question about the shell's slug rules,
		// which the iframe can't see — and guessing wrong makes the
		// parent navigate the window the link was clicked in, eating
		// the context the `_blank` asked to keep.
		clickLink(
			'<a href="/wp-admin/upload.php?mode=grid" target="_blank">Grid view</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	test( 'a plain click carries no new-context flag', () => {
		clickLink( '<a href="/wp-admin/edit.php">Posts</a>' );

		expect( adminLinkMessages()[ 0 ].newContext ).toBe( false );
	} );

	test( 'a _blank non-admin link still opens a real browser tab', () => {
		// Front-end and off-site URLs have no window to open into; the
		// external-tab escalation is for plain clicks only.
		clickLink(
			'<a href="https://wordpress.org/documentation/" target="_blank">Documentation</a>'
		);

		expect( posted ).toHaveLength( 0 );
	} );

	test( 'a _top admin link keeps its escape from the shell', () => {
		// `_top` is a deliberate "replace the whole shell". Hijacking
		// it into a window would remove the only exit a page has.
		clickLink(
			'<a href="/wp-admin/options-general.php" target="_top">Settings</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	test( 'a named target is left to the tab it reuses', () => {
		// `post.php`'s Preview reuses one tab per post across clicks —
		// a window cannot honour that contract.
		clickLink(
			'<a href="/wp-admin/edit.php" target="wp-preview-4">Preview</a>'
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

describe( 'chromeless bridge: which submits light the status ring', () => {
	/*
	 * The fetch + XHR wrappers miss the admin's most common save, a
	 * classic POST, which navigates. Getting that half back is easy to
	 * get wrong: a start with no end wedges the ring lit for the life
	 * of the window, so submits that will never navigate stay silent.
	 */
	test( 'a settings POST opens an activity the next document closes', () => {
		submitForm(
			'<form method="post" action="options.php"><input name="blogname"></form>'
		);

		expect( activityMessages() ).toEqual( [
			{ type: 'os-iframe-activity', phase: 'start', navigation: true },
		] );
	} );

	test.each( [
		// The search box above every list table: nothing changed, so
		// nothing can have failed to change.
		[ 'a GET form is a read', '<form method="get" action="edit.php"><input name="s"></form>', undefined ],
		// Aimed at another browsing context — this document stays put.
		[ 'a submit aimed elsewhere', '<form method="post" action="options.php" target="_blank"></form>', undefined ],
		// Handled in-page: it either fires its own XHR, which is
		// already instrumented, or does nothing at all.
		[
			'a submit a script handles itself',
			'<form method="post" action="options.php"></form>',
			( form: HTMLFormElement ) =>
				form.addEventListener( 'submit', ( e ) => e.preventDefault() ),
		],
	] )( '%s stays silent', ( _label, html, onForm ) => {
		submitForm( html as string, onForm as ( ( f: HTMLFormElement ) => void ) | undefined );

		expect( activityMessages() ).toHaveLength( 0 );
	} );
} );
