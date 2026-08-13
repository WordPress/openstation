/**
 * Unit tests for launcher inference — the thing that lets a window
 * appear to grow out of the icon that opened it without a single call
 * site passing an element down.
 *
 * The failure mode this guards is invisible rather than loud: a wrong
 * or stale answer here does not throw, it produces a window that morphs
 * out of the wrong place (or out of nowhere), which reads as a glitch
 * rather than as a bug. So the resolution ORDER and the two rejection
 * cases are pinned by name.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type LauncherModule = typeof import( '../../src/view-transitions/launcher' );
type PlayModule = typeof import( '../../src/view-transitions/play' );

async function load(): Promise< {
	launcher: LauncherModule;
	play: PlayModule;
} > {
	vi.resetModules();
	return {
		launcher: await import( '../../src/view-transitions/launcher' ),
		play: await import( '../../src/view-transitions/play' ),
	};
}

/** Simulate the user pressing an element, the way the tracker sees it. */
function press( el: Element ): void {
	el.dispatchEvent(
		new MouseEvent( 'pointerdown', { bubbles: true, composed: true } ),
	);
}

describe( 'view-transition launcher inference', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'finds the dock tile a click landed inside', async () => {
		const { launcher, play } = await load();
		play.trackViewTransitionOrigin();

		document.body.innerHTML = `
			<div class="os-dock__item">
				<button class="os-dock__item-primary">
					<span class="glyph"></span>
				</button>
			</div>
		`;
		const glyph = document.querySelector( '.glyph' )!;
		press( glyph );

		// The inner button, not the outer tile: a morph starting from
		// the icon glyph alone is both smaller and better-looking than
		// one starting from the tile including its label and running
		// indicator. The selector list is ordered for exactly this.
		expect( launcher.findLaunchSource() ).toBe(
			document.querySelector( '.os-dock__item-primary' ),
		);
	} );

	test( 'the opt-in attribute outranks every built-in selector', async () => {
		const { launcher, play } = await load();
		play.trackViewTransitionOrigin();

		document.body.innerHTML = `
			<div class="os-dock__item">
				<button data-os-vt-launcher>
					<span class="glyph"></span>
				</button>
			</div>
		`;
		press( document.querySelector( '.glyph' )! );

		expect( launcher.findLaunchSource() ).toBe(
			document.querySelector( '[data-os-vt-launcher]' ),
		);
	} );

	test( 'returns null when nothing launcher-shaped was pressed', async () => {
		const { launcher, play } = await load();
		play.trackViewTransitionOrigin();

		document.body.innerHTML = '<div class="not-a-launcher"></div>';
		press( document.querySelector( '.not-a-launcher' )! );

		// A window with no launcher plays an un-paired transition, which
		// is correct: there was nothing for it to have come from.
		expect( launcher.findLaunchSource() ).toBeNull();
	} );

	test( 'returns null when the pressed element has been re-rendered away', async () => {
		const { launcher, play } = await load();
		play.trackViewTransitionOrigin();

		document.body.innerHTML =
			'<button class="os-dock__item-primary"></button>';
		const tile = document.querySelector( '.os-dock__item-primary' )!;
		press( tile );
		// The dock re-renders on almost every state change; pairing a
		// transition to a detached node produces a morph that starts
		// from nowhere.
		tile.remove();

		expect( launcher.findLaunchSource() ).toBeNull();
	} );

	test( 'honours the excluded element so a window cannot morph out of itself', async () => {
		const { launcher, play } = await load();
		play.trackViewTransitionOrigin();

		document.body.innerHTML = `
			<div class="os-window">
				<button class="close">x</button>
			</div>
		`;
		const win = document.querySelector< HTMLElement >( '.os-window' )!;
		press( document.querySelector( '.close' )! );

		// `.os-window` is a legitimate fallback launcher — a window
		// opened from a link inside another window should morph out of
		// that window. But a window restoring itself must not.
		expect( launcher.findLaunchSource() ).toBe( win );
		expect( launcher.findLaunchSource( win ) ).toBeNull();
	} );

	test( 'the filter can redirect or suppress the morph', async () => {
		const { launcher, play } = await load();
		const hooks = await import( '../../src/hooks' );
		play.trackViewTransitionOrigin();

		document.body.innerHTML = `
			<button class="os-dock__item-primary"></button>
			<div id="elsewhere"></div>
		`;
		press( document.querySelector( '.os-dock__item-primary' )! );

		const elsewhere = document.getElementById( 'elsewhere' );
		hooks.addFilter(
			hooks.HOOKS.VIEW_TRANSITION_LAUNCHER,
			'test/redirect',
			() => elsewhere,
		);
		expect( launcher.findLaunchSource() ).toBe( elsewhere );
	} );

	test( 'isShellBooting reads the PHP-set boot gate', async () => {
		const { launcher } = await load();
		expect( launcher.isShellBooting() ).toBe( false );

		const area = document.createElement( 'div' );
		area.id = 'os-area';
		area.className = 'os-area os-area--booting';
		document.body.appendChild( area );
		// Session restore reopens every window through the same funnel
		// a click uses; without this gate a refresh would play one
		// transition per restored window over an area PHP has
		// deliberately made invisible.
		expect( launcher.isShellBooting() ).toBe( true );

		area.classList.remove( 'os-area--booting' );
		expect( launcher.isShellBooting() ).toBe( false );
	} );
} );
