/**
 * Window submenu tabs — hover-intent prewarm.
 *
 * A mouse resting on a submenu tab asks the service worker to fetch
 * that screen's document (the window then navigates in place to it). A
 * tab a native window claims never loads in this iframe — the click
 * opens the native window — so the hover warms that window instead,
 * with the params the click will open it with. The tab already on
 * screen warms nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { Window } from '../../src/window';
import { _resetSpeculation } from '../../src/pwa/speculate';
import { _resetNativeUrlRemap, bindNativeUrlRemap, registerNativeUrlRemap } from '../../src/native-url-remap';
import type { WindowConfig } from '../../src/types';

const DWELL_MS = 120;
const ADMIN = `${ window.location.origin }/wp-admin/`;

let postMessage: ReturnType< typeof vi.fn >;
let prewarmWindow: ReturnType< typeof vi.fn >;
let win: Window;

function hover( el: Element ): void {
	// jsdom has no PointerEvent; the handler only reads `pointerType`.
	const ev = new MouseEvent( 'pointerover', { bubbles: true } );
	Object.defineProperty( ev, 'pointerType', { value: 'mouse' } );
	el.dispatchEvent( ev );
}

function tab( label: string ): HTMLElement {
	const found = Array.from( win.element.querySelectorAll< HTMLElement >( '.os-window__tab[data-url]' ) )
		.find( ( t ) => t.textContent?.includes( label ) );
	if ( ! found ) {
		throw new Error( `no tab "${ label }"` );
	}
	return found;
}

beforeEach( () => {
	vi.useFakeTimers();
	installHooksStub();
	_resetSpeculation();
	postMessage = vi.fn();
	Object.defineProperty( navigator, 'serviceWorker', {
		value: { controller: { postMessage } },
		configurable: true,
	} );
	prewarmWindow = vi.fn( async () => true );
	( window as unknown as { wp: unknown } ).wp = {
		...( ( window as unknown as { wp?: object } ).wp ?? {} ),
		os: { getOsSettings: () => ( { windowPrewarmEnabled: true } ), prewarmWindow },
	};
	const config: WindowConfig = {
		id: 'tools',
		url: `${ ADMIN }tools.php`,
		parentUrl: `${ ADMIN }tools.php`,
		title: 'Tools',
		icon: 'dashicons-admin-tools',
		x: 40,
		y: 40,
		width: 900,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		submenu: [
			{ title: 'Available Tools', url: `${ ADMIN }tools.php` },
			{ title: 'Site Health', url: `${ ADMIN }site-health.php` },
			{ title: 'Comments', url: `${ ADMIN }edit-comments.php` },
		],
	};
	// The real registry (the setup file loads the window module before
	// any per-test mock could): the native Comments window claims
	// edit-comments.php and opens with its `post` param, as in desktop.ts.
	bindNativeUrlRemap( { getSnapshot: () => ( {} ) as never, openById: () => true, adminUrl: ADMIN } );
	registerNativeUrlRemap( {
		id: 'desktop-mode-comments',
		nativeWindowId: 'desktop-mode-comments',
		matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit-comments.php' ),
		params: ( _url, parsed ) => {
			const postId = parseInt( parsed.searchParams.get( 'p' ) ?? '0', 10 );
			return { post: postId > 0 ? postId : 0 };
		},
	} );
	win = new Window( config );
	document.body.appendChild( win.element );
} );

afterEach( () => {
	vi.useRealTimers();
	clearHooksStub();
	_resetNativeUrlRemap();
	delete ( window as unknown as { wp?: { os?: unknown } } ).wp?.os;
	document.body.innerHTML = '';
} );

describe( 'window submenu tabs — hover prewarm', () => {
	test( 'a resting pointer asks the worker for the exact URL the click will load', () => {
		hover( tab( 'Site Health' ) );
		expect( postMessage ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( DWELL_MS );
		expect( postMessage ).toHaveBeenCalledWith( {
			type: 'os-speculate-doc',
			url: `${ ADMIN }site-health.php?openstation_chromeless=1`,
		} );
	} );

	test( 'a tab a native window claims warms that window, with its open params', () => {
		hover( tab( 'Comments' ) );
		vi.advanceTimersByTime( DWELL_MS );
		expect( prewarmWindow ).toHaveBeenCalledWith( 'desktop-mode-comments', { params: { post: 0 } } );
		expect( postMessage ).not.toHaveBeenCalled();
	} );

	test( 'the tab already on screen warms nothing', () => {
		const current = tab( 'Available Tools' );
		current.classList.add( 'os-window__tab--active' );
		hover( current );
		vi.advanceTimersByTime( DWELL_MS );
		expect( postMessage ).not.toHaveBeenCalled();
		expect( prewarmWindow ).not.toHaveBeenCalled();
	} );
} );
