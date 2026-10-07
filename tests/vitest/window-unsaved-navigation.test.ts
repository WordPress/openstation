import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetWindowChannelsForTests } from '../../src/window-channels';
import {
	_resetWindowLoadingTransitionsForTests,
	installWindowLoadingTransitions,
} from '../../src/window/loading';

const ADMIN = window.location.origin + '/wp-admin/';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'unsaved-probe',
		url: ADMIN + 'user-new.php',
		title: 'Add User',
		icon: 'dashicons-admin-users',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		...overrides,
	};
}

let win: Window;
let parent: HTMLElement;

let asked: { type?: string; requestId?: string }[];

function stubContentWindow(): void {
	asked = [];
	Object.defineProperty( win.iframe as HTMLIFrameElement, 'contentWindow', {
		value: {
			postMessage: ( m: unknown ) => {
				asked.push( m as { type?: string; requestId?: string } );
			},
		},
		configurable: true,
	} );
}

function answerGuard( prevent: boolean ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			data: {
				type: 'os-bridge-beforeunload-response',
				prevent,
				requestId: asked[ asked.length - 1 ]?.requestId,
			},
			origin: window.location.origin,
		} ),
	);
}

describe( 'a navigation the page inside can refuse', () => {
	beforeEach( () => {
		installHooksStub();
		_resetWindowChannelsForTests();

		_resetWindowLoadingTransitionsForTests();
		installWindowLoadingTransitions();
		parent = document.createElement( 'div' );
		document.body.appendChild( parent );
		win = new Window( baseConfig() );
		parent.appendChild( win.element );
		stubContentWindow();

		win._iframeBridgeReady = true;

		win.markContentLoaded();
	} );

	afterEach( () => {
		vi.useRealTimers();
		parent.remove();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a withheld paint runs once, when the frame reports it left', () => {
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		expect( commit ).not.toHaveBeenCalled();

		win._commitDeferredNavigation();
		expect( commit ).toHaveBeenCalledTimes( 1 );

		win._commitDeferredNavigation();
		expect( commit ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a paint nobody claimed expires', () => {
		vi.useFakeTimers();
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		vi.advanceTimersByTime( 15001 );
		win._commitDeferredNavigation();

		expect( commit ).not.toHaveBeenCalled();
	} );

	test( 'a newer withheld paint replaces the older one', () => {
		const first = vi.fn();
		const second = vi.fn();

		win._deferNavigationCommit( first, 15000 );
		win._deferNavigationCommit( second, 15000 );
		win._commitDeferredNavigation();

		expect( first ).not.toHaveBeenCalled();
		expect( second ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'reload asks before it paints, and withholds on a guarded page', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		win.reload();

		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		expect( asked[ 0 ].type ).toBe( 'os-bridge-beforeunload-query' );
		expect( loading ).not.toHaveBeenCalled();

		answerGuard( true );
		await vi.waitFor( () =>
			expect( win._deferredNavigationCommit ).not.toBeNull(),
		);

		expect( loading ).not.toHaveBeenCalled();

		win._commitDeferredNavigation();
		expect( loading ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'reload paints straight away when nothing is holding on', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		win.reload();
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		answerGuard( false );

		await vi.waitFor( () => expect( loading ).toHaveBeenCalledTimes( 1 ) );
		expect( win._deferredNavigationCommit ).toBeNull();
	} );

	test( 'a second reload click cannot slip past the in-flight query', async () => {
		win.reload();
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );

		win.reload();
		expect( asked ).toHaveLength( 1 );
	} );

	test( 'navigateTo withholds its overlay and its tab highlight', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		expect( win.navigateTo( ADMIN + 'profile.php' ) ).toBe( true );
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		answerGuard( true );
		await vi.waitFor( () =>
			expect( win._deferredNavigationCommit ).not.toBeNull(),
		);

		expect( loading ).not.toHaveBeenCalled();
	} );

	test( 'destroying the window drops a withheld paint', () => {
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		win.destroy();
		win._commitDeferredNavigation();

		expect( commit ).not.toHaveBeenCalled();
	} );
} );
