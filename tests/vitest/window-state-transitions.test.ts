/**
 * Cross-state transition tests for {@link Window}.
 *
 * The four state-changing entry points (`maximize`, `toggleMaximize`,
 * `toggleFullscreen`, `minimize` + `restore`) all mutate a shared
 * `state` field AND a small set of CSS modifier classes on the window
 * root. Earlier revisions of the class let those drift out of sync: a
 * toggle would add its modifier without removing the existing one,
 * silently flipping `state` while the visual stayed unchanged because
 * the leftover class still carried the heavier styling. This file
 * exercises every "from-state × action" pair so any regression that
 * stacks classes, loses the saved floating geometry, or forgets the
 * pre-minimize state surfaces as a hard failure.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
): { win: Window; parent: HTMLElement; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
	Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );
	return {
		win,
		parent,
		cleanup: () => {
			parent.remove();
		},
	};
}

/** Read the active state class from the element (there should be exactly one or none). */
function activeStateClasses( el: HTMLElement ): string[] {
	const all = [
		'desktop-mode-window--maximized',
		'desktop-mode-window--fullscreen',
		'desktop-mode-window--snapped-left',
		'desktop-mode-window--snapped-right',
		'desktop-mode-window--minimized',
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
		// `installHooksStub` mutates window.wp.hooks; the cleanup re-
		// installs a fresh stub each test so individual cases stay
		// isolated. `hooks` reference is retained for assertions in
		// tests that recordActions on it directly.
		void hooks;
	} );

	test( 'fullscreen → maximize: exits fullscreen, enters maximized, no class stacking', () => {
		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--fullscreen',
		] );

		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'maximized' );
		// Only the maximized class — fullscreen must be stripped, no
		// stacking. This is the exact bug the user reported: clicking
		// maximize while in fullscreen produced no visible change
		// because `--fullscreen` (with !important) was still active.
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--maximized',
		] );
	} );

	test( 'fullscreen → maximize → fullscreen: re-enters fullscreen cleanly', () => {
		handle.win.toggleFullscreen(); // normal → fullscreen
		handle.win.toggleMaximize(); // fullscreen → maximized
		handle.win.toggleFullscreen(); // maximized → fullscreen

		expect( handle.win.state ).toBe( 'fullscreen' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--fullscreen',
		] );
	} );

	test( 'maximized → fullscreen → exit fullscreen: returns to maximized', () => {
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );

		handle.win.toggleFullscreen(); // exit fullscreen

		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--maximized',
		] );
	} );

	test( 'normal → fullscreen → exit fullscreen: returns to normal with original geometry', () => {
		// Force a known starting position so we can assert the restore
		// lands on it. The base config's `x: 40, y: 40, width: 800,
		// height: 600` is applied by the Window constructor.
		const startLeft = handle.win.element.offsetLeft;
		const startTop = handle.win.element.offsetTop;
		const startW = handle.win.element.offsetWidth;
		const startH = handle.win.element.offsetHeight;

		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();

		expect( handle.win.state ).toBe( 'normal' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [] );
		expect( handle.win.element.style.left ).toBe( `${ startLeft }px` );
		expect( handle.win.element.style.top ).toBe( `${ startTop }px` );
		expect( handle.win.element.style.width ).toBe( `${ startW }px` );
		expect( handle.win.element.style.height ).toBe( `${ startH }px` );
	} );

	test( 'snapped-left → fullscreen → exit fullscreen: returns to snapped-left', () => {
		handle.win.applySnap( 'left' );
		expect( handle.win.state ).toBe( 'snapped-left' );

		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'fullscreen' );
		// Snap class must not leak alongside fullscreen.
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--fullscreen',
		] );

		handle.win.toggleFullscreen();
		expect( handle.win.state ).toBe( 'snapped-left' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--snapped-left',
		] );
	} );

	test( 'snapped-left → maximize: enters maximized cleanly', () => {
		handle.win.applySnap( 'left' );

		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--maximized',
		] );
	} );

	test( 'maximize → minimize → restore: returns to maximized (not normal)', () => {
		handle.win.toggleMaximize();
		handle.win.minimize();
		expect( handle.win.state ).toBe( 'minimized' );

		handle.win.restore();

		// Pre-fix: restore() unconditionally set state='normal' while
		// leaving --maximized on the element. Now the underlying state
		// is preserved across the minimize/restore round trip.
		expect( handle.win.state ).toBe( 'maximized' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--maximized',
		] );
	} );

	test( 'fullscreen → minimize → restore: returns to fullscreen', () => {
		handle.win.toggleFullscreen();
		handle.win.minimize();
		expect( handle.win.state ).toBe( 'minimized' );

		handle.win.restore();

		expect( handle.win.state ).toBe( 'fullscreen' );
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--fullscreen',
		] );
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
		// A second minimize() — could come from a redundant click on
		// the taskbar tile or a state-restoration race — must not
		// overwrite _stateBeforeMinimize with 'minimized' (which would
		// then leak into restore and break the round-trip).
		handle.win.minimize();

		handle.win.restore();

		expect( handle.win.state ).toBe( 'maximized' );
	} );

	test( 'normal → fullscreen → maximize → toggle-off: returns to original floating geometry', () => {
		const startLeft = handle.win.element.offsetLeft;
		const startTop = handle.win.element.offsetTop;
		const startW = handle.win.element.offsetWidth;
		const startH = handle.win.element.offsetHeight;

		handle.win.toggleFullscreen();
		handle.win.toggleMaximize(); // fullscreen → maximized
		handle.win.toggleMaximize(); // maximized → normal

		// The original floating geometry must survive the chain — at
		// each transition the saved geometry rule "capture only when
		// leaving 'normal'" prevents the maximized 0,0,parentW,parentH
		// from overwriting the real pre-flight rect.
		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( `${ startLeft }px` );
		expect( handle.win.element.style.top ).toBe( `${ startTop }px` );
		expect( handle.win.element.style.width ).toBe( `${ startW }px` );
		expect( handle.win.element.style.height ).toBe( `${ startH }px` );
	} );

	test( 'maximize → fullscreen → toggle-off fullscreen → toggle-off maximize: lands on original geometry', () => {
		const startLeft = handle.win.element.offsetLeft;
		const startTop = handle.win.element.offsetTop;
		const startW = handle.win.element.offsetWidth;
		const startH = handle.win.element.offsetHeight;

		handle.win.toggleMaximize(); // normal → maximized (geo saved)
		handle.win.toggleFullscreen(); // maximized → fullscreen (geo stays)
		handle.win.toggleFullscreen(); // fullscreen → maximized
		handle.win.toggleMaximize(); // maximized → normal

		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( `${ startLeft }px` );
		expect( handle.win.element.style.top ).toBe( `${ startTop }px` );
		expect( handle.win.element.style.width ).toBe( `${ startW }px` );
		expect( handle.win.element.style.height ).toBe( `${ startH }px` );
	} );

	test( 'maximize() one-way does not overwrite saved geometry when called from fullscreen', () => {
		const startLeft = handle.win.element.offsetLeft;
		const startTop = handle.win.element.offsetTop;
		const startW = handle.win.element.offsetWidth;
		const startH = handle.win.element.offsetHeight;

		handle.win.toggleFullscreen();
		// Direct call to one-way maximize — exercises the
		// "state !== 'normal' → don't re-save" branch.
		handle.win.maximize();

		expect( handle.win.state ).toBe( 'maximized' );
		expect( handle.win._savedGeometry ).toEqual( {
			x: startLeft,
			y: startTop,
			width: startW,
			height: startH,
		} );
	} );
} );
