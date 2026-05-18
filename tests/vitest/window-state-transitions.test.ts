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

/**
 * JSDOM returns 0 for every `offsetLeft / offsetTop / offsetWidth /
 * offsetHeight` regardless of the inline styles the Window writes, so
 * the saved-geometry assertions need explicit stubs to be meaningful.
 * Without these stubs, the "did we preserve the original floating
 * geometry?" tests reduce to `0 === 0` and pass for the wrong reason.
 *
 * The stubs are read by every code path that captures geometry
 * (`maximize()`, `toggleFullscreen()`, `_savedFullscreenState`,
 * `applySnap` callers) so they form the ground truth of "what does
 * 'the current rect' resolve to" for this test fixture.
 */
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
		// The stubbed `offsetLeft/Top/Width/Height` from `mountWindow`
		// are the ground truth for "current rect" — `toggleFullscreen`
		// captures them into `_savedFullscreenState`, and the exit
		// path writes them back to inline styles. Assertions compare
		// inline styles against the known stubbed values so the test
		// fails loudly if the save/restore round-trip drops anything.
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
			'desktop-mode-window--minimized',
		].filter( ( c ) => handle.win.element.classList.contains( c ) ) );
		// Tightened: only `--fullscreen` should remain. The `--minimized`
		// is removed by `restore()`; if either side gets stuck the test
		// catches it.
		expect( activeStateClasses( handle.win.element ) ).toEqual( [
			'desktop-mode-window--fullscreen',
		] );
	} );

	test( 'fullscreen → minimize → restore: refreshes fullscreen body class', () => {
		// Regression guard for the observation that `restore()` to a
		// fullscreen state used to leave UI side-effects stale. The
		// body class controls admin-bar hiding (see
		// `assets/css/desktop.css` rule on
		// `body.desktop-mode-has-fullscreen-window`) — if it falls out
		// of sync after restore, the admin bar reappears on top of a
		// supposedly-fullscreen window.
		handle.win.toggleFullscreen();
		expect(
			document.body.classList.contains( 'desktop-mode-has-fullscreen-window' ),
		).toBe( true );
		handle.win.minimize();
		// Simulate something else clearing the body class while the
		// window was hidden (a re-render race, a sibling window's
		// close path, etc.). Restore must rebuild it.
		document.body.classList.remove( 'desktop-mode-has-fullscreen-window' );

		handle.win.restore();

		expect(
			document.body.classList.contains( 'desktop-mode-has-fullscreen-window' ),
		).toBe( true );
	} );

	test( 'fullscreen → minimize → restore: refreshes focus-button aria-pressed/label', () => {
		// The focus (fullscreen) title-bar button is rendered by the
		// controls system, so the easiest reliable way to assert its
		// state is to seed the element with a button matching the
		// selector `updateFocusButtonState` queries, then verify the
		// attributes after the round-trip.
		const btn = document.createElement( 'button' );
		btn.className = 'desktop-mode-window__btn desktop-mode-window__btn--focus';
		handle.win.element.appendChild( btn );

		handle.win.toggleFullscreen();
		expect( btn.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		handle.win.minimize();
		// Simulate a re-render that reset the button to its default
		// "not pressed" state during the minimized period.
		btn.setAttribute( 'aria-pressed', 'false' );
		btn.classList.remove( 'desktop-mode-window__btn--active' );

		handle.win.restore();

		expect( btn.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect(
			btn.classList.contains( 'desktop-mode-window__btn--active' ),
		).toBe( true );
	} );

	test( 'restore() to maximized fires WINDOW_RESTORED but NOT WINDOW_MAXIMIZED', () => {
		// Documents the intentional semantic from the doc note: a
		// minimize/restore round-trip is treated as a visibility
		// change, not a state transition. The window never left
		// 'maximized' from the framework's perspective; firing
		// WINDOW_MAXIMIZED again would mislead plugin authors who use
		// it to detect "entered maximize for the first time."
		const fired: string[] = [];
		hooks.addAction(
			'desktop-mode.window.restored',
			'test',
			() => {
				fired.push( 'restored' );
			},
		);
		hooks.addAction(
			'desktop-mode.window.maximized',
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
		// Same semantic for the fullscreen path.
		const fired: string[] = [];
		hooks.addAction(
			'desktop-mode.window.restored',
			'test',
			() => {
				fired.push( 'restored' );
			},
		);
		hooks.addAction(
			'desktop-mode.window.fullscreen-entered',
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
		// A second minimize() — could come from a redundant click on
		// the taskbar tile or a state-restoration race — must not
		// overwrite _stateBeforeMinimize with 'minimized' (which would
		// then leak into restore and break the round-trip).
		handle.win.minimize();

		handle.win.restore();

		expect( handle.win.state ).toBe( 'maximized' );
	} );

	test( 'normal → fullscreen → maximize → toggle-off: returns to original floating geometry', () => {
		handle.win.toggleFullscreen();
		handle.win.toggleMaximize(); // fullscreen → maximized
		handle.win.toggleMaximize(); // maximized → normal

		// The original floating geometry (stubbed via `mountWindow`)
		// must survive the chain — at each transition the saved
		// geometry rule "capture only when leaving 'normal'" prevents
		// the maximized 0,0,parentW,parentH from overwriting the real
		// pre-flight rect.
		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'maximize → fullscreen → toggle-off fullscreen → toggle-off maximize: lands on original geometry', () => {
		handle.win.toggleMaximize(); // normal → maximized (geo saved)
		handle.win.toggleFullscreen(); // maximized → fullscreen (geo stays)
		handle.win.toggleFullscreen(); // fullscreen → maximized
		handle.win.toggleMaximize(); // maximized → normal

		// This is the exact case the bug 2 review flagged: when exiting
		// fullscreen via the "saved state was maximized" branch, an
		// earlier revision re-saved `_savedGeometry` from the inline
		// maximized rect (0,0,parentW,parentH). The final
		// toggle-off-maximize would then restore to the desktop area's
		// full bounds rather than the original 40,60 / 800×600.
		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'maximize() one-way does not overwrite saved geometry when called from fullscreen', () => {
		handle.win.toggleFullscreen();
		// Direct call to one-way maximize — exercises the
		// "state !== 'normal' → don't re-save" branch. After the
		// transition the toggle-off should still land us on the
		// original floating rect.
		handle.win.maximize();
		handle.win.toggleMaximize();

		expect( handle.win.state ).toBe( 'normal' );
		expect( handle.win.element.style.left ).toBe( '40px' );
		expect( handle.win.element.style.top ).toBe( '60px' );
		expect( handle.win.element.style.width ).toBe( '800px' );
		expect( handle.win.element.style.height ).toBe( '600px' );
	} );

	test( 'fullscreen exit-to-maximized emits state-change exactly once', () => {
		// Bug-3 regression guard. The exit-to-maximized path used to
		// call `this.maximize()` (which `_emitChange`s) and then the
		// shared tail also `_emitChange`d — two events per transition.
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();

		const events: Event[] = [];
		const listener = ( e: Event ): void => {
			events.push( e );
		};
		document.addEventListener( 'desktop-mode-window-changed', listener );
		handle.win.toggleFullscreen(); // exit fullscreen → restore to maximized
		document.removeEventListener( 'desktop-mode-window-changed', listener );

		expect( events ).toHaveLength( 1 );
	} );

	test( 'fullscreen → maximize via Maximize button fires FULLSCREEN_EXITED then MAXIMIZED, in that order', () => {
		// Bug-5 regression guard — the two code paths that produce a
		// fullscreen → maximized transition must fire actions in the
		// same order so plugin authors get a predictable sequence
		// regardless of which button the user clicked.
		const fired: string[] = [];
		hooks.addAction(
			'desktop-mode.window.fullscreen-exited',
			'test',
			() => {
				fired.push( 'fullscreen-exited' );
			},
		);
		hooks.addAction(
			'desktop-mode.window.maximized',
			'test',
			() => {
				fired.push( 'maximized' );
			},
		);

		handle.win.toggleFullscreen();
		fired.length = 0; // reset — we only care about what the next click fires
		handle.win.toggleMaximize();

		expect( fired ).toEqual( [ 'fullscreen-exited', 'maximized' ] );
	} );

	test( 'fullscreen → exit-to-maximized via Focus button fires same hook sequence', () => {
		// Symmetric to the previous test — exiting fullscreen with a
		// saved maximized prior state should produce the same hook
		// order as toggleMaximize-from-fullscreen.
		const fired: string[] = [];
		hooks.addAction(
			'desktop-mode.window.fullscreen-exited',
			'test',
			() => {
				fired.push( 'fullscreen-exited' );
			},
		);
		hooks.addAction(
			'desktop-mode.window.maximized',
			'test',
			() => {
				fired.push( 'maximized' );
			},
		);

		handle.win.toggleMaximize(); // normal → maximized
		handle.win.toggleFullscreen(); // maximized → fullscreen
		fired.length = 0;
		handle.win.toggleFullscreen(); // fullscreen → maximized (restore)

		expect( fired ).toEqual( [ 'fullscreen-exited', 'maximized' ] );
	} );

	test( 'subscribers reading state in FULLSCREEN_EXITED handler see the new state, not stale fullscreen', () => {
		// Bug 5 sibling concern — when the exit hook fires, `win.state`
		// must already reflect the post-transition value. Otherwise a
		// plugin author who branches on state inside their handler
		// gets inconsistent results depending on which code path
		// triggered the exit.
		const observed: string[] = [];
		hooks.addAction(
			'desktop-mode.window.fullscreen-exited',
			'test',
			() => {
				observed.push( handle.win.state );
			},
		);

		// Path A: toggleFullscreen exit when saved was maximized.
		handle.win.toggleMaximize();
		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();
		// Path B: toggleMaximize from fullscreen.
		handle.win.toggleFullscreen();
		handle.win.toggleMaximize();

		expect( observed ).toEqual( [ 'maximized', 'maximized' ] );
	} );
} );
