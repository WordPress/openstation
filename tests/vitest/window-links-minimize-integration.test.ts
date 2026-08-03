/**
 * Integration repro for "minimizing the ROOT window closes it":
 * REAL `WindowManager` + real `Window` instances with the window-links
 * engine and render host wired exactly like production boot. Minimize
 * the root of a relation group (post + comment) and assert the window
 * survives — still in the manager, still restorable.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const ORIGIN = window.location.origin;

function makeOsSettings() {
	const snapshot = {
		windowLinkRenderer: 'svg-splines',
		windowLinkVisibility: 'always',
		windowLinksEnabled: true,
		windowLinkRaiseOnFocus: true,
		windowLinkHighlight: true,
	};
	const listeners = new Set< ( s: unknown ) => void >();
	return {
		getOsSettingsSnapshot: () => ( { ...snapshot } ),
		subscribeOsSettings: ( cb: ( s: unknown ) => void ) => {
			listeners.add( cb );
			return () => listeners.delete( cb );
		},
	};
}

describe( 'window-links × real WindowManager — minimize survives', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let rafQueue: FrameRequestCallback[];

	function flushRaf(): void {
		for ( let i = 0; i < 5 && rafQueue.length > 0; i++ ) {
			const batch = rafQueue.splice( 0 );
			for ( const cb of batch ) {
				cb( performance.now() );
			}
		}
	}

	beforeEach( () => {
		installHooksStub();
		_resetAllSharedStoresForTests();
		rafQueue = [];
		vi.stubGlobal(
			'requestAnimationFrame',
			( cb: FrameRequestCallback ) => {
				rafQueue.push( cb );
				return rafQueue.length;
			},
		);
		desktop = document.createElement( 'div' );
		desktop.id = 'os-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetAllSharedStoresForTests();
		vi.resetModules();
	} );

	test( 'layer elevation drops back when an unrelated window takes focus', async () => {
		vi.resetModules();
		const engine = await import( '../../src/window-links/engine' );
		const host = await import( '../../src/window-links/render-host' );
		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager,
			osSettings: makeOsSettings() as never,
		} );

		const postWin = await manager.open( {
			id: 'post-php-post-102',
			url: `${ ORIGIN }/wp-admin/post.php?post=102&action=edit`,
			title: 'Post 102',
			x: 100,
			y: 100,
			width: 800,
			height: 600,
		} );
		await manager.open( {
			// Fully INSIDE the post window's footprint — the user's
			// "comment completely hidden behind the post" scenario.
			id: 'comment-php-c-500',
			url: `${ ORIGIN }/wp-admin/comment.php?action=editcomment&c=500`,
			title: 'Comment 500',
			x: 300,
			y: 300,
			width: 200,
			height: 150,
		} );
		const strangerWin = await manager.open( {
			id: 'index-php',
			url: `${ ORIGIN }/wp-admin/index.php`,
			title: 'Dashboard',
			x: 1200,
			y: 100,
			width: 300,
			height: 200,
		} );

		engine.setWindowContent(
			'post-php-post-102',
			{ type: 'post', id: 102 },
			{ source: 'bridge' },
		);
		engine.setWindowContent(
			'comment-php-c-500',
			{ type: 'comment', id: 500, root: { type: 'post', id: 102 } },
			{ source: 'bridge' },
		);
		flushRaf();

		const layer = document.getElementById(
			'os-window-links-elevated',
		)!;

		// Focus the post → the elevated layer lifts to the group ceiling.
		manager.focus( postWin );
		flushRaf();
		expect( layer.style.zIndex ).not.toBe( '' );

		// Focus the unrelated window → the layer MUST drop back to the
		// stylesheet default (inline z cleared) so the tie hides
		// behind the windows again.
		manager.focus( strangerWin );
		flushRaf();
		expect( layer.style.zIndex ).toBe( '' );
	} );

	test( 'minimizing the focused root keeps it in the manager and restorable', async () => {
		vi.resetModules();
		const engine = await import( '../../src/window-links/engine' );
		const host = await import( '../../src/window-links/render-host' );
		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager,
			osSettings: makeOsSettings() as never,
		} );

		const postWin = await manager.open( {
			id: 'post-php-post-102',
			url: `${ ORIGIN }/wp-admin/post.php?post=102&action=edit`,
			title: 'Post 102',
		} );
		const commentWin = await manager.open( {
			id: 'comment-php-c-500',
			url: `${ ORIGIN }/wp-admin/comment.php?action=editcomment&c=500`,
			title: 'Comment 500',
		} );

		// Bridge identities → one relation group, root focused last?
		// Focus the ROOT (like the user clicking the post window).
		engine.setWindowContent(
			'post-php-post-102',
			{ type: 'post', id: 102 },
			{ source: 'bridge' },
		);
		engine.setWindowContent(
			'comment-php-c-500',
			{ type: 'comment', id: 500, root: { type: 'post', id: 102 } },
			{ source: 'bridge' },
		);
		manager.focus( postWin );
		flushRaf();

		// Sanity: group renderable, both windows alive.
		expect( engine.listWindowLinkEdges() ).toHaveLength( 1 );
		expect( manager.getAll() ).toHaveLength( 2 );

		// The user clicks the minimize control on the ROOT.
		postWin.minimize();
		flushRaf();

		// The window must still exist, be minimized (NOT destroyed),
		// and restore cleanly.
		expect( manager.getById( 'post-php-post-102' ) ).toBe( postWin );
		expect( postWin.state ).toBe( 'minimized' );
		expect( postWin.element.isConnected ).toBe( true );
		expect( postWin._isDestroyed ?? false ).toBe( false );

		postWin.restore();
		flushRaf();
		expect( postWin.state ).not.toBe( 'minimized' );
		expect( manager.getAll() ).toHaveLength( 2 );

		// And the relations survived the round-trip.
		expect( engine.listWindowLinkEdges() ).toHaveLength( 1 );

		// Also exercise the "minimize then focus the child" path — the
		// group raise must NOT resurrect or destroy the minimized root.
		postWin.minimize();
		manager.focus( commentWin );
		flushRaf();
		expect( manager.getById( 'post-php-post-102' ) ).toBe( postWin );
		expect( postWin.state ).toBe( 'minimized' );
	} );
} );
