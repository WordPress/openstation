import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'w1',
		url: 'http://example.test/wp-admin/edit.php',
		title: 'Editor',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		...overrides,
	};
}

function mountWindow(
	cfg: WindowConfig,
	rect: { left: number; top: number; width: number; height: number } = {
		left: 40,
		top: 60,
		width: 800,
		height: 600,
	},
): { win: Window; parent: HTMLElement; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
	Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );
	Object.defineProperty( win.element, 'offsetLeft', {
		value: rect.left,
		configurable: true,
	} );
	Object.defineProperty( win.element, 'offsetTop', {
		value: rect.top,
		configurable: true,
	} );
	Object.defineProperty( win.element, 'offsetWidth', {
		value: rect.width,
		configurable: true,
	} );
	Object.defineProperty( win.element, 'offsetHeight', {
		value: rect.height,
		configurable: true,
	} );
	return {
		win,
		parent,
		cleanup: () => {
			parent.remove();
		},
	};
}

function activeStateClasses( el: HTMLElement ): string[] {
	const all = [
		'os-window--maximized',
		'os-window--fullscreen',
		'os-window--snapped-left',
		'os-window--snapped-right',
		'os-window--minimized',
	];
	return all.filter( ( c ) => el.classList.contains( c ) );
}

describe( 'Window — state transitions are mutually exclusive', () => {
	let hooks: FakeWpHooks;
	let handle: ReturnType< typeof mountWindow >;

	beforeEach( () => {
		hooks = installHooksStub();
		handle = mountWindow( baseConfig() );
	} );

	afterEach( () => {
		handle.cleanup();
		clearHooksStub();
	} );

	test( 'fullscreen → maximize: exits fullscreen, enters maximized, no class stacking', () => {
		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--fullscreen',
		] );

		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'maximized' );

		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--maximized',
		] );
	} );

	test( 'fullscreen → maximize → fullscreen: re-enters fullscreen cleanly', () => {
		handle.win.toggleFullscreen();
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();

		expect( handle.win.state ).toBe( 'fullscreen' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--fullscreen',
		] );
	} );

	test( 'maximized → fullscreen → exit fullscreen: returns to maximized', () => {
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );

		handle.win.toggleFullscreen();

		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--maximized',
		] );
	} );

	test( 'normal → fullscreen → exit fullscreen: returns to normal with original geometry', () => {

		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();

		expect( handle.win.state ).toBe( 'normal' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [] );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'snapped-left → fullscreen → exit fullscreen: returns to snapped-left', () => {
		handle.win.applySnap( 'left' );
		expect( handle.win.state ).toBe( 'snapped-left' );

		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );

		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--fullscreen',
		] );

		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'snapped-left' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--snapped-left',
		] );
	} );

	test( 'snapped-left → maximize: enters maximized cleanly', () => {
		handle.win.applySnap( 'left' );

		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--maximized',
		] );
	} );

	test( 'maximize → minimize → restore: returns to maximized (not normal)', () => {
		handle.win.toggleMaximize();
		handle.win.minimize();
		expect( handle.win.state ).toBe( 'minimized' );

		handle.win.restore();

		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--maximized',
		] );
	} );

	test( 'fullscreen → minimize → restore: returns to fullscreen', () => {
		handle.win.toggleFullscreen();
		handle.win.minimize();
		expect( handle.win.state ).toBe( 'minimized' );

		handle.win.restore();

		expect( handle.win.state ).toBe( 'fullscreen' );

		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'os-window--fullscreen',
		] );
	} );

	test( 'fullscreen → minimize → restore: refreshes fullscreen body class', () => {

		handle.win.toggleFullscreen();
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		handle.win.minimize();

		document.body.classList.remove( 'os-has-fullscreen-window' );

		handle.win.restore();

		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
	} );

	test( 'fullscreen → minimize: clears fullscreen body class while minimized', () => {

		handle.win.toggleFullscreen();
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );

		handle.win.minimize();

		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );
	} );

	test( 'minimizing one fullscreen window keeps body class for another visible fullscreen window', () => {

		const other = mountWindow( baseConfig( { id: 'w2' } ) );
		try {
			handle.win.toggleFullscreen();
			other.win.toggleFullscreen();

			handle.win.minimize();

			expect(
				document.body.classList.contains( 'os-has-fullscreen-window' ),
			).toBe( true );

			other.win.minimize();

			expect(
				document.body.classList.contains( 'os-has-fullscreen-window' ),
			).toBe( false );
		} finally {
			other.cleanup();
		}
	} );

	test( 'fullscreen → minimize → restore: refreshes focus-button aria-pressed/label', () => {

		const btn = document.createElement( 'button' );
		btn.className = 'os-window__btn os-window__btn--focus';
		handle.win.element.appendChild( btn );

		handle.win.toggleFullscreen();
		expect( btn.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		handle.win.minimize();

		btn.setAttribute( 'aria-pressed', 'false' );
		btn.classList.remove( 'os-window__btn--active' );

		handle.win.restore();

		expect( btn.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect(
			btn.classList.contains( 'os-window__btn--active' ),
		).toBe( true );
	} );

	test( 'restore() to maximized fires WINDOW_RESTORED but NOT WINDOW_MAXIMIZED', () => {

		const fired: string[] = [];
		hooks.addAction(
			'os.window.restored',
			'test',
			() => {
				fired.push( 'restored' );
			},
		);
		hooks.addAction(
			'os.window.maximized',
			'test',
			() => {
				fired.push( 'maximized' );
			},
		);

		handle.win.toggleMaximize();
		fired.length = 0;
		handle.win.minimize();
		handle.win.restore();

		expect( fired ).toEqual( [ 'restored' ] );
	} );

	test( 'restore() to fullscreen fires WINDOW_RESTORED but NOT WINDOW_FULLSCREEN_ENTERED', () => {

		const fired: string[] = [];
		hooks.addAction(
			'os.window.restored',
			'test',
			() => {
				fired.push( 'restored' );
			},
		);
		hooks.addAction(
			'os.window.fullscreen-entered',
			'test',
			() => {
				fired.push( 'fullscreen-entered' );
			},
		);

		handle.win.toggleFullscreen();
		fired.length = 0;
		handle.win.minimize();
		handle.win.restore();

		expect( fired ).toEqual( [ 'restored' ] );
	} );

	test( 'snapped-right → minimize → restore: returns to snapped-right', () => {
		handle.win.applySnap( 'right' );
		handle.win.minimize();

		handle.win.restore();

		expect( handle.win.state ).toBe( 'snapped-right' );
	} );

	test( 'minimize is a no-op when already minimized — saved state not clobbered', () => {
		handle.win.toggleMaximize();
		handle.win.minimize();

		handle.win.minimize();

		handle.win.restore();

		expect( handle.win.state ).toBe( 'maximized' );
	} );

	test( 'normal → fullscreen → maximize → toggle-off: returns to original floating geometry', () => {
		handle.win.toggleFullscreen();
		handle.win.toggleMaximize();
		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'maximize → fullscreen → toggle-off fullscreen → toggle-off maximize: lands on original geometry', () => {
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();
		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'maximize() one-way does not overwrite saved geometry when called from fullscreen', () => {
		handle.win.toggleFullscreen();

		handle.win.maximize();
		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'fullscreen exit-to-maximized emits state-change exactly once', () => {

		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();

		const events: Event[] = [];
		const listener = ( e: Event ): void => {
			events.push( e );
		};
		document.addEventListener( 'os-window-changed', listener );
		handle.win.toggleFullscreen();
		document.removeEventListener( 'os-window-changed', listener );

		expect( events ).toHaveLength( 1 );
	} );

	test( 'fullscreen → maximize via Maximize button fires FULLSCREEN_EXITED then MAXIMIZED, in that order', () => {

		const fired: string[] = [];
		hooks.addAction(
			'os.window.fullscreen-exited',
			'test',
			() => {
				fired.push( 'fullscreen-exited' );
			},
		);
		hooks.addAction(
			'os.window.maximized',
			'test',
			() => {
				fired.push( 'maximized' );
			},
		);

		handle.win.toggleFullscreen();
		fired.length = 0;
		handle.win.toggleMaximize();

		expect( fired ).toEqual( [ 'fullscreen-exited', 'maximized' ] );
	} );

	test( 'fullscreen → exit-to-maximized via Focus button fires same hook sequence', () => {

		const fired: string[] = [];
		hooks.addAction(
			'os.window.fullscreen-exited',
			'test',
			() => {
				fired.push( 'fullscreen-exited' );
			},
		);
		hooks.addAction(
			'os.window.maximized',
			'test',
			() => {
				fired.push( 'maximized' );
			},
		);

		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		fired.length = 0;
		handle.win.toggleFullscreen();

		expect( fired ).toEqual( [ 'fullscreen-exited', 'maximized' ] );
	} );

	test( 'subscribers reading state in FULLSCREEN_EXITED handler see the new state, not stale fullscreen', () => {

		const observed: string[] = [];
		hooks.addAction(
			'os.window.fullscreen-exited',
			'test',
			() => {
				observed.push( handle.win.state );
			},
		);

		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();

		handle.win.toggleFullscreen();
		handle.win.toggleMaximize();

		expect( observed ).toEqual( [ 'maximized', 'maximized' ] );
	} );

	test( 'minimize and restore invoke WAAPI flight animation when dock tile is present', () => {

		const dockEl = document.createElement( 'div' );
		dockEl.className = 'os-dock__item';
		dockEl.setAttribute( 'data-os-window-base-id', 'w1' );
		dockEl.getBoundingClientRect = vi.fn( () => ( {
			left: 500,
			top: 700,
			right: 548,
			bottom: 748,
			width: 48,
			height: 48,
			x: 500,
			y: 700,
			toJSON: () => {},
		} ) );
		document.body.appendChild( dockEl );

		handle.win.element.getBoundingClientRect = vi.fn( () => ( {
			left: 40,
			top: 60,
			right: 840,
			bottom: 660,
			width: 800,
			height: 600,
			x: 40,
			y: 60,
			toJSON: () => {},
		} ) );

		const animateSpy = vi.fn( () => ( {
			onfinish: null,
			oncancel: null,
			cancel: vi.fn(),
		} ) );
		handle.win.element.animate = animateSpy as unknown as typeof handle.win.element.animate;

		handle.win.minimize();
		expect( handle.win.element.classList.contains( 'os-window--minimizing' ) ).toBe( true );
		expect( animateSpy ).toHaveBeenCalledTimes( 1 );

		handle.win.restore();
		expect( handle.win.element.classList.contains( 'os-window--restoring' ) ).toBe( true );
		expect( animateSpy ).toHaveBeenCalledTimes( 2 );

		dockEl.remove();
	} );

	test( 'minimize skips WAAPI animation when prefers-reduced-motion is active', () => {

		const origMatchMedia = window.matchMedia;
		window.matchMedia = vi.fn().mockReturnValue( { matches: true } );

		const animateSpy = vi.fn();
		handle.win.element.animate = animateSpy as unknown as typeof handle.win.element.animate;

		handle.win.minimize();
		expect( handle.win.element.classList.contains( 'os-window--minimized' ) ).toBe( true );
		expect( animateSpy ).not.toHaveBeenCalled();

		window.matchMedia = origMatchMedia;
	} );
} );
