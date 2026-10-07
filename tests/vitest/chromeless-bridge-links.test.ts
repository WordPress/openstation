import { describe, expect, test, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

let posted: Array< Record< string, unknown > > = [];

function emittedBridgeScript(): string {
	return readFileSync(
		resolve( ROOT, 'src/chromeless-bridge.js' ),
		'utf8'
	);
}

beforeAll( () => {

	Object.defineProperty( window, 'parent', {
		value: {
			postMessage: ( data: Record< string, unknown > ) => {
				posted.push( data );
			},
		},
		configurable: true,
	} );

	(
		window as unknown as { __osChromelessData: Record< string, unknown > }
	).__osChromelessData = {
		_menuPayload: null,
		_menuSig: null,
		_identity: null,
		_softReload: [],
	};

	(
		window as unknown as { __openStationScreenMetaInstalled: boolean }
	).__openStationScreenMetaInstalled = true;

	( 0, eval )( emittedBridgeScript() );

	document.addEventListener( 'click', ( e ) => e.preventDefault() );
} );

beforeEach( () => {
	posted = [];
	document.body.innerHTML = '';
} );

function submitForm(
	html: string,
	onForm?: ( form: HTMLFormElement ) => void
): void {
	document.body.innerHTML = html;
	const form = document.querySelector( 'form' ) as HTMLFormElement;
	onForm?.( form );
	form.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );
}

function activityMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-iframe-activity' );
}

function clickLink( html: string ): string {
	document.body.innerHTML = html;
	const link = document.querySelector( 'a' ) as HTMLAnchorElement;
	link.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, cancelable: true } )
	);
	return link.getAttribute( 'href' ) ?? '';
}

function adminLinkMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-iframe-admin-link' );
}

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

	test( 'the Upload Plugin toggle stays with plugin-install.js', () => {
		clickLink(
			'<div class="wrap plugin-install-tab-featured">' +
				'<a href="/wp-admin/plugin-install.php?tab=upload" class="upload-view-toggle page-title-action">Upload Plugin</a>' +
				'</div>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

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

	test( 'Jetpack Stats routes stay with Jetpack', () => {
		const before = window.location.href;
		history.replaceState(
			null,
			'',
			'/wp-admin/admin.php?page=stats&openstation_chromeless=1'
		);

		try {
			clickLink(
				'<div id="wpcom"><a href="/stats/day/referrers/example.com">View all</a></div>'
			);
			expect( posted ).toHaveLength( 0 );

			clickLink(
				'<div id="wpcom"><a href="/hello-world/">Hello world</a></div>'
			);
			expect( posted.map( ( m ) => m.type ) ).toEqual( [
				'os-external-link',
			] );
		} finally {
			history.replaceState( null, '', before );
		}
	} );
} );

describe( 'chromeless bridge: the label a link ships to the shell', () => {

	function label(): unknown {
		return adminLinkMessages()[ 0 ]?.label;
	}

	test( 'screen-reader text is not part of the visible label', () => {

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

	test( 'a _blank admin link is claimed for a desktop window', () => {
		clickLink(
			'<a href="/wp-admin/revision.php?revision=24" target="_blank" rel="external noopener">Open classic revisions screen</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 1 );
		expect( adminLinkMessages()[ 0 ].url ).toContain(
			'/wp-admin/revision.php'
		);
		expect( adminLinkMessages()[ 0 ].url ).toContain( 'revision=24' );

		expect( adminLinkMessages()[ 0 ].newContext ).toBe( true );
	} );

	test( 'a _blank to another view of the same admin file is left to the browser', () => {

		clickLink(
			'<a href="/wp-admin/upload.php?mode=grid" target="_blank">Grid view</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	test( 'a plain click carries no new-context flag', () => {
		clickLink( '<a href="/wp-admin/edit.php">Posts</a>' );

		expect( adminLinkMessages()[ 0 ].newContext ).toBe( false );
	} );

	test( 'another admin is handed to the shell for its own instance', () => {

		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );

		try {
			for ( const path of [ '/site2/wp-admin/', '/wp-admin/network/sites.php' ] ) {
				expect( clickLink( `<a href="${ path }">Go</a>` ) ).toBe( path );
				const routed = posted.filter(
					( m ) => m.type === 'os-iframe-other-admin-link'
				);
				expect( routed[ routed.length - 1 ].url ).toBe(
					`http://localhost${ path }`
				);
			}
			expect( open ).not.toHaveBeenCalled();
			expect( adminLinkMessages() ).toHaveLength( 0 );

			document.body.innerHTML =
				'<a href="/wp-admin/network/sites.php">Go</a>';
			const before = posted.length;
			( document.querySelector( 'a' ) as HTMLAnchorElement ).dispatchEvent(
				new MouseEvent( 'click', {
					bubbles: true,
					cancelable: true,
					metaKey: true,
				} )
			);
			expect( posted ).toHaveLength( before );
			expect( open ).not.toHaveBeenCalled();

			clickLink( '<a href="/wp-admin/options-general.php">Settings</a>' );
			expect( adminLinkMessages() ).toHaveLength( 1 );
		} finally {
			open.mockRestore();
		}
	} );

	test( 'a _blank non-admin link still opens a real browser tab', () => {

		clickLink(
			'<a href="https://wordpress.org/documentation/" target="_blank">Documentation</a>'
		);

		expect( posted ).toHaveLength( 0 );
	} );

	test( 'a _top admin link keeps its escape from the shell', () => {

		clickLink(
			'<a href="/wp-admin/options-general.php" target="_top">Settings</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );

	test( 'a named target is left to the tab it reuses', () => {

		clickLink(
			'<a href="/wp-admin/edit.php" target="wp-preview-4">Preview</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 0 );
	} );
} );

describe( 'chromeless bridge: the referer stamp on unowned links', () => {

	const DELETE_LINK =
		'<a href="/wp-admin/post.php?action=delete&post=7&_wpnonce=abc" class="submitdelete aria-button-if-js">Delete Permanently</a>';

	test( 'the href gains the source page as _wp_http_referer', () => {
		const href = clickLink( DELETE_LINK );

		expect( adminLinkMessages() ).toHaveLength( 0 );
		expect( referer( href ) ).toBe( '/wp-admin/upload.php' );
	} );

	test( 'the hint drops the chromeless flag it inherits from this page', () => {

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

		clickLink(
			'<a href="/wp-admin/post.php?action=trash&post=7&_wpnonce=abc" class="submitdelete">Trash</a>'
		);

		expect( adminLinkMessages() ).toHaveLength( 1 );
	} );

	test( 'owned JS buttons are not stamped', () => {

		const href = clickLink(
			'<a href="/wp-admin/comment.php?action=unapprovecomment&c=3&_wpnonce=abc" class="vim-u aria-button-if-js" data-wp-lists="dim:the-comment-list:comment-3">Unapprove</a>'
		);

		expect( href ).not.toContain( '_wp_http_referer' );
	} );
} );

describe( 'chromeless bridge: which submits light the status ring', () => {

	test( 'a settings POST opens an activity the next document closes', () => {
		submitForm(
			'<form method="post" action="options.php"><input name="blogname"></form>'
		);

		expect( activityMessages() ).toEqual( [
			{ type: 'os-iframe-activity', phase: 'start', navigation: true },
		] );
	} );

	test( 'a bulk action reports, even over GET', () => {

		submitForm(
			'<form id="posts-filter" method="get">' +
				'<select name="action">' +
				'<option value="-1">Bulk actions</option>' +
				'<option value="trash" selected>Move to Trash</option>' +
				'</select></form>'
		);

		expect( activityMessages() ).toHaveLength( 1 );
	} );

	test( 'the Filter button is not a bulk action, whatever is selected', () => {

		document.body.innerHTML =
			'<form id="posts-filter" method="get">' +
			'<select name="action">' +
			'<option value="trash" selected>Move to Trash</option>' +
			'</select>' +
			'<input type="submit" name="filter_action" value="Filter">' +
			'</form>';
		const form = document.querySelector( 'form' ) as HTMLFormElement;
		form.dispatchEvent(
			new SubmitEvent( 'submit', {
				bubbles: true,
				cancelable: true,
				submitter: document.querySelector(
					'[name="filter_action"]'
				) as HTMLElement,
			} )
		);

		expect( activityMessages() ).toHaveLength( 0 );
	} );

	test.each( [

		[ 'a GET form is a read', '<form method="get" action="edit.php"><input name="s"></form>', undefined ],

		[
			'a GET form with no bulk action picked',
			'<form method="get"><select name="action"><option value="-1" selected>Bulk actions</option></select><input name="s"></form>',
			undefined,
		],

		[ 'a submit aimed elsewhere', '<form method="post" action="options.php" target="_blank"></form>', undefined ],

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

describe( 'chromeless bridge: a content-change broadcast', () => {
	test( 'refreshes the list it matches in place', async () => {
		const fetchMock = vi.fn(
			async () => new Response( '<div id="wpbody-content">Published</div>' )
		);
		vi.stubGlobal( 'fetch', fetchMock );
		document.body.innerHTML = '<div id="wpbody-content">Draft</div>';

		try {

			window.dispatchEvent(
				new MessageEvent( 'message', {
					origin: window.location.origin,
					data: { type: 'os-broadcast', topic: 'os.attachment.changed', payload: {} },
				} )
			);

			await vi.waitFor( () =>
				expect( document.getElementById( 'wpbody-content' )?.textContent ).toBe( 'Published' )
			);
			expect( fetchMock ).toHaveBeenCalledWith( window.location.href, expect.anything() );
		} finally {
			vi.unstubAllGlobals();
		}
	} );
} );
