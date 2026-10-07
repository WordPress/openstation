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

		manager.focus( postWin );
		flushRaf();
		expect( layer.style.zIndex ).not.toBe( '' );

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

		expect( engine.listWindowLinkEdges() ).toHaveLength( 1 );
		expect( manager.getAll() ).toHaveLength( 2 );

		postWin.minimize();
		flushRaf();

		expect( manager.getById( 'post-php-post-102' ) ).toBe( postWin );
		expect( postWin.state ).toBe( 'minimized' );
		expect( postWin.element.isConnected ).toBe( true );
		expect( postWin._isDestroyed ?? false ).toBe( false );

		postWin.restore();
		flushRaf();
		expect( postWin.state ).not.toBe( 'minimized' );
		expect( manager.getAll() ).toHaveLength( 2 );

		expect( engine.listWindowLinkEdges() ).toHaveLength( 1 );

		postWin.minimize();
		manager.focus( commentWin );
		flushRaf();
		expect( manager.getById( 'post-php-post-102' ) ).toBe( postWin );
		expect( postWin.state ).toBe( 'minimized' );
	} );
} );
