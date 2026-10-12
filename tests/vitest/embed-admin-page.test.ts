/**
 * `embedAdminPage()` — an admin page inside a native window's panel
 * (the Posts app's "Add Post" tab).
 *
 *   - It paints the same loading mark as a window. It used to be a
 *     `comet` with no size — the 48px default — so after the window's
 *     large WordPress mark the user saw a much smaller, different one,
 *     which read as the loader shrinking mid-load.
 *   - The page's content identity is the WINDOW's while the panel is
 *     on screen, so the Preview eye (and Related, revisions, window
 *     ties) work for the embedded editor. Hiding or tearing down the
 *     panel hands the window back the identity it had before.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { embedAdminPage } from '../../src/native-windows';
import {
	getWindowContent,
	setWindowContent,
} from '../../src/window-links/engine';
import {
	LOADING_SPINNER_PRESET,
	LOADING_SPINNER_SIZE,
} from '../../src/window/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-posts';

/** Whether the embedded iframe reports a layout box (is "on screen"). */
let shown = true;
/** The ResizeObserver callback the embed registered, to replay edges. */
let resizeCallback: ( () => void ) | null = null;

beforeEach( () => {
	installHooksStub();
	shown = true;
	resizeCallback = null;
	// jsdom has no layout: drive visibility by hand.
	vi.spyOn( HTMLIFrameElement.prototype, 'getClientRects' ).mockImplementation(
		() => ( shown ? [ {} ] : [] ) as unknown as DOMRectList,
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor( cb: () => void ) {
				resizeCallback = cb;
			}
			observe(): void {}
			disconnect(): void {}
		},
	);
	setWindowContent( WINDOW_ID, null, { source: 'config' } );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	clearHooksStub();
	document.body.innerHTML = '';
} );

function mount(): {
	host: HTMLElement;
	iframe: HTMLIFrameElement;
	teardown: () => void;
} {
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	const teardown = embedAdminPage( host, '/wp-admin/post-new.php', {
		windowId: WINDOW_ID,
	} );
	return { host, iframe: host.querySelector( 'iframe' )!, teardown };
}

/** The page inside announces its identity, as the chromeless bridge does. */
function announce( iframe: HTMLIFrameElement, identity: unknown ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			data: { type: 'os-content-identity', identity },
			origin: window.location.origin,
			source: iframe.contentWindow,
		} ),
	);
}

const DRAFT = {
	type: 'post',
	id: 42,
	previewUrl: `${ window.location.origin }/?p=42&preview=true`,
};

describe( 'embedAdminPage', () => {
	test( 'paints the window overlay preset and size', () => {
		const { host, teardown } = mount();

		const spinner = host.querySelector( 'os-spinner' );
		expect( spinner?.getAttribute( 'preset' ) ).toBe(
			LOADING_SPINNER_PRESET,
		);
		expect( spinner?.getAttribute( 'size' ) ).toBe( LOADING_SPINNER_SIZE );

		teardown();
	} );

	test( "the page's identity becomes the window's while shown", () => {
		const { iframe, teardown } = mount();

		// post-new.php before the first save announces null.
		announce( iframe, null );
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		// The save-watcher re-announces once the draft exists.
		announce( iframe, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( {
			id: 42,
			previewUrl: DRAFT.previewUrl,
		} );

		teardown();
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();
	} );

	test( 'hiding the panel releases the identity, showing re-claims it', () => {
		const { iframe, teardown } = mount();
		announce( iframe, DRAFT );

		shown = false; // e.g. the user picked "All posts"
		resizeCallback?.();
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		shown = true;
		resizeCallback?.();
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( { id: 42 } );

		teardown();
	} );

	test( 'releasing restores the identity the window had before', () => {
		setWindowContent(
			WINDOW_ID,
			{ type: 'post-list', id: 1 },
			{ source: 'config' },
		);
		const { iframe, teardown } = mount();
		announce( iframe, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( { id: 42 } );

		teardown();
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( {
			type: 'post-list',
			id: 1,
		} );
	} );

	test( 'ignores identities from another frame', () => {
		const { teardown } = mount();
		const other = document.createElement( 'iframe' );
		document.body.appendChild( other );

		announce( other, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		teardown();
	} );
} );
