import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import * as bc from '../../src/broadcast';

const WINDOW_ID = 'desktop-mode-my-wordpress';

interface NativeWindowsGlobal {
	desktopModeNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	desktopModeWindowConfig?: Record< string, unknown >;
}

function installTemplateMarkup( host: HTMLElement ): void {
	host.innerHTML = `
		<div class="desktop-mode-my-wordpress" data-desktop-mode-my-wordpress-root>
			<header data-desktop-mode-my-wordpress-breadcrumbs></header>
			<div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body>
				<div class="desktop-mode-my-wordpress__loading" data-desktop-mode-my-wordpress-loading hidden></div>
			</div>
			<div class="desktop-mode-folder-status-bar" data-desktop-mode-my-wordpress-status></div>
		</div>
	`;
}

describe( 'my-wordpress — cross-window sync reactiveness', () => {
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( async () => {
		installHooksStub();
		vi.useFakeTimers();

		// Set up window.wp.desktop with mock subscription capabilities
		const w = window as unknown as { wp?: Record< string, unknown > };
		w.wp = {
			...( w.wp ?? {} ),
			desktop: {
				...( ( w.wp?.desktop as Record< string, unknown > | undefined ) ?? {} ),
				subscribe: bc.subscribe,
				broadcast: bc.broadcast,
			},
		};

		// Stub the shell config the bundle reads via `getConfig()`.
		( window as unknown as NativeWindowsGlobal ).desktopModeWindowConfig = {
			[ WINDOW_ID ]: {
				restRoot: 'http://example.test/wp-json/',
				restNonce: 'nonce',
				editPostUrlBase: 'http://example.test/wp-admin/post.php',
				editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
				entities: [
					{
						id: 'posts',
						label: 'Posts',
						icon: 'dashicons-admin-post',
						restPath: 'wp/v2/posts',
						kind: 'post',
						post_type: 'post', // mapped CPT/Post Type
					},
					{
						id: 'users',
						label: 'Users',
						icon: 'dashicons-admin-users',
						restPath: 'wp/v2/users',
						kind: 'user', // no post_type mapped
					},
				],
				perPage: 24,
				mediaPerPage: 48,
				previewActions: [],
			},
		};

		fetchSpy = vi.fn( () =>
			Promise.resolve(
				new Response( '[]', {
					status: 200,
					headers: { 'X-WP-Total': '0' },
				} ),
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		// Side-effect import installs the render callback.
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		const w = window as unknown as { wp?: Record< string, unknown > };
		if ( w.wp ) {
			delete w.wp.desktop;
		}
	} );

	test( 'subscribes to events for entities with post_type but not for others', () => {
		const render = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		expect( typeof render ).toBe( 'function' );

		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-window__body';
		installTemplateMarkup( body );
		document.body.appendChild( body );

		const subscribeSpy = vi.spyOn( window.wp.desktop, 'subscribe' );

		const teardown = render!( body );

		// Should subscribe to post topic
		expect( subscribeSpy ).toHaveBeenCalledWith( 'desktop-mode.post.changed', expect.any( Function ) );
		// Should NOT subscribe to users topic (since no post_type mapped)
		expect( subscribeSpy ).not.toHaveBeenCalledWith( 'desktop-mode.users.changed', expect.any( Function ) );

		if ( typeof teardown === 'function' ) {
			teardown();
		}
	} );

	test( 'refreshes active list when receiving external broadcast matching entity topic', async () => {
		const render = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-window__body';
		installTemplateMarkup( body );
		document.body.appendChild( body );

		const teardown = render!( body );

		// Navigate to the list view by double clicking the post folder tile
		const postTile = body.querySelector< HTMLElement >( '[data-entity-id="posts"]' );
		expect( postTile ).not.toBeNull();
		postTile!.dispatchEvent( new Event( 'dblclick' ) );
		await vi.runOnlyPendingTimersAsync();

		const initialFetchCalls = fetchSpy.mock.calls.length;
		expect( initialFetchCalls ).toBeGreaterThan( 0 );

		// Simulate external broadcast
		bc.broadcast( 'desktop-mode.post.changed', { source: 'recycle-bin', action: 'untrashed' } );

		// Advance timers past 150ms debounce
		vi.advanceTimersByTime( 150 );
		await vi.runOnlyPendingTimersAsync();

		// Refresh should trigger navigation causing new fetch calls
		expect( fetchSpy.mock.calls.length ).toBeGreaterThan( initialFetchCalls );

		if ( typeof teardown === 'function' ) {
			teardown();
		}
	} );

	test( 'does NOT refresh when broadcast source is my-wordpress itself', async () => {
		const render = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-window__body';
		installTemplateMarkup( body );
		document.body.appendChild( body );

		const teardown = render!( body );

		// Navigate to the list view by double clicking the post folder tile
		const postTile = body.querySelector< HTMLElement >( '[data-entity-id="posts"]' );
		expect( postTile ).not.toBeNull();
		postTile!.dispatchEvent( new Event( 'dblclick' ) );
		await vi.runOnlyPendingTimersAsync();

		const initialFetchCalls = fetchSpy.mock.calls.length;

		// Simulate broadcast from my-wordpress itself
		bc.broadcast( 'desktop-mode.post.changed', { source: 'my-wordpress', action: 'trashed' } );

		vi.advanceTimersByTime( 150 );
		await vi.runOnlyPendingTimersAsync();

		// No extra fetch requests should be fired (avoiding infinite loops)
		expect( fetchSpy.mock.calls.length ).toBe( initialFetchCalls );

		if ( typeof teardown === 'function' ) {
			teardown();
		}
	} );
} );
