/**
 * The shell tour — five coachmarks, three of which advance on the real
 * events.
 *
 * Pins the contract the tour exists for: the two opening cards orient
 * and step on click, a gesture step completes when the user does the
 * thing (a window opens, a snap commits, the palette opens), leaving
 * records the dismissal exactly once, and the two replay signals start
 * it whatever the boot gate said.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	endShellTour,
	isShellTourRunning,
	SHELL_TOUR_INTRO_SLUG,
	startShellTour,
	type ShellTourDeps,
	type ShellTourWindowLike,
} from '../../src/shell-tour';
import {
	installShellTour,
	MOUNT_DELAY_MS,
	shouldAutoStartShellTour,
} from '../../src/shell-tour/loader';
import { HOOKS } from '../../src/hooks';
import type { OsCoachmark } from '../../src/ui/components/os-coachmark/os-coachmark';
import type { DesktopConfig } from '../../src/types';
import { clearHooksStub, installHooksStub, type FakeWpHooks } from './helpers/hooks-stub';

const settle = async (): Promise< void > => {
	for ( let i = 0; i < 4; i++ ) {
		await Promise.resolve();
	}
};

function fakeWindow( id: string ): ShellTourWindowLike & { applySnap: ReturnType< typeof vi.fn > } {
	const element = document.createElement( 'div' );
	element.className = 'os-window';
	document.body.appendChild( element );
	return { id, element, applySnap: vi.fn() };
}

describe( 'shell tour', () => {
	let hooks: FakeWpHooks;
	let fetchSpy: ReturnType< typeof vi.fn >;
	let windows: Map< string, ShellTourWindowLike >;
	let deps: ShellTourDeps & {
		openPalette: ReturnType< typeof vi.fn >;
		openFallbackWindow: ReturnType< typeof vi.fn >;
		openLayoutSettings: ReturnType< typeof vi.fn >;
	};

	beforeEach( () => {
		hooks = installHooksStub();
		fetchSpy = vi.fn().mockResolvedValue( { ok: true } );
		( globalThis as unknown as { fetch: unknown } ).fetch = fetchSpy;
		windows = new Map();
		deps = {
			config: { seenIntrosUrl: 'https://example.test/wp-json/desktop-mode/v1/intros', restNonce: 'n' },
			windowManager: { getById: ( id ) => windows.get( id ) },
			openPalette: vi.fn(),
			openFallbackWindow: vi.fn(),
			openLayoutSettings: vi.fn( () => 'os-settings' ),
		};
	} );
	afterEach( () => {
		endShellTour();
		document.body.innerHTML = '';
		clearHooksStub();
		vi.useRealTimers();
	} );

	const mark = (): OsCoachmark => document.querySelector( 'os-coachmark' ) as OsCoachmark;
	const primary = (): HTMLElement =>
		mark().shadowRoot!.querySelector< HTMLElement >( 'os-button.primary' )!;

	/** Click past the two orienting cards to 'Open a window'. */
	const skipIntroCards = (): void => {
		primary();
		primary().click();
		primary().click();
	};

	test( 'the real events advance the steps, and Done records the tour once', async () => {
		startShellTour( deps );
		await settle();
		expect( isShellTourRunning() ).toBe( true );
		expect( mark().getAttribute( 'step' ) ).toBe( '1' );
		expect( mark().getAttribute( 'total' ) ).toBe( '5' );

		skipIntroCards();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		const win = fakeWindow( 'w1' );
		windows.set( 'w1', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w1' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
		expect( mark().anchor ).toBe( win.element );

		hooks.doAction( HOOKS.SNAP_ZONE_COMMITTED, { windowId: 'w1', zone: 'left' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '5' );
		expect( mark().anchor ).toBeNull();

		document.dispatchEvent( new CustomEvent( 'os-palette-opened', { detail: { id: 'x' } } ) );
		expect( mark().hasAttribute( 'step' ) ).toBe( false );
		expect( mark().getAttribute( 'secondary-label' ) ).toBe( '' );

		await settle();
		mark().shadowRoot!.querySelector< HTMLElement >( 'os-button.primary' )!.click();
		expect( isShellTourRunning() ).toBe( false );
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( 'https://example.test/wp-json/desktop-mode/v1/intros/seen' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { slug: SHELL_TOUR_INTRO_SLUG } );
	} );

	test( 'Skip records the tour exactly once; a later Escape does not post again', async () => {
		startShellTour( deps );
		await settle();
		const m = mark();
		m.shadowRoot!.querySelector< HTMLElement >( 'os-button.secondary' )!.click();
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );

		m.shadowRoot!
			.querySelector< HTMLElement >( '.card' )!
			.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		endShellTour();
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
	} );

	test( '"Do it for me" snaps the opened window and opens the palette through the shell', async () => {
		startShellTour( deps );
		await settle();
		skipIntroCards();
		const win = fakeWindow( 'w2' );
		windows.set( 'w2', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w2' } );

		primary().click();
		expect( win.applySnap ).toHaveBeenCalledWith( 'left' );
		expect( mark().getAttribute( 'step' ) ).toBe( '5' );

		primary().click();
		expect( deps.openPalette ).toHaveBeenCalledTimes( 1 );
		expect( mark().hasAttribute( 'step' ) ).toBe( false );
	} );

	test( 'step 1 also advances when the screen was already open (reopen, not open)', async () => {
		// Taking the tour with Posts already on the desk: the dock tile
		// still calls open(), but the manager answers an existing
		// singleton with WINDOW_REOPENED, so a tour listening only for
		// WINDOW_OPENED left "Do it for me" dead.
		startShellTour( deps );
		await settle();
		skipIntroCards();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		const win = fakeWindow( 'w9' );
		windows.set( 'w9', win );
		hooks.doAction( HOOKS.WINDOW_REOPENED, { windowId: 'w9' } );

		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
		// The reopened window is the one the snap card snaps and anchors to.
		expect( mark().anchor ).toBe( win.element );
	} );

	test( '"Do it for me" on the open-window card activates the dock tile\'s primary button, else the fallback', async () => {
		// The dock binds its open handler on the inner primary button,
		// not on the tile; clicking the tile itself opened nothing.
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.innerHTML =
			'<div class="os-dock__item" data-nav-id="menu-posts"><button class="os-dock__item-primary">Posts</button></div>';
		document.body.appendChild( dock );
		const opened = vi.fn();
		dock.querySelector( '.os-dock__item-primary' )!.addEventListener( 'click', opened );

		startShellTour( deps );
		await settle();
		// The orienting cards point at the rail; the gesture card at the tile.
		expect( mark().anchor ).toBe( dock );
		skipIntroCards();
		expect( mark().anchor ).toBe( dock.querySelector( '.os-dock__item' ) );
		primary().click();
		expect( opened ).toHaveBeenCalledTimes( 1 );
		expect( deps.openFallbackWindow ).not.toHaveBeenCalled();
		// Still on the open-window card: the window opens asynchronously
		// and the hook advances it.
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		endShellTour();
		dock.remove();
		startShellTour( deps );
		await settle();
		// The ended coachmark lingers 60 ms to restore focus; take the new one.
		const latest = (): HTMLElement => {
			const marks = document.querySelectorAll< OsCoachmark >( 'os-coachmark' );
			return marks[ marks.length - 1 ].shadowRoot!.querySelector< HTMLElement >(
				'os-button.primary',
			)!;
		};
		latest().click(); // menus
		latest().click(); // layout
		latest().click(); // open a window, with no tile to click
		expect( deps.openFallbackWindow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the orienting cards point at the rail, and the layout card opens Preferences', async () => {
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.innerHTML =
			'<div class="os-dock__item" data-nav-id="menu-posts"><button class="os-dock__item-primary">Posts</button></div>';
		document.body.appendChild( dock );

		startShellTour( deps );
		await settle();
		expect( mark().getAttribute( 'heading' ) ).toBe( 'All your menu items are here' );
		expect( mark().anchor ).toBe( dock );

		primary().click();
		expect( mark().getAttribute( 'heading' ) ).toBe( 'Configure the layout as you wish' );
		expect( mark().anchor ).toBe( dock );
		expect( deps.openLayoutSettings ).not.toHaveBeenCalled();

		primary().click();
		expect( deps.openLayoutSettings ).toHaveBeenCalledTimes( 1 );
		// Opening Preferences is not the completion signal; the card steps
		// on its own rather than waiting for `os.window.opened`, which
		// belongs to the card after it.
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );
		expect( mark().getAttribute( 'heading' ) ).toBe( 'Open a window' );
	} );

	test( 'the window the layout card opens does not complete the card after it', async () => {
		// Preferences opens a window, and `os.window.opened` lands a tick
		// later — with the next card already on screen waiting for
		// exactly that event. Without this the tour answered its own
		// question and skipped "Open a window" entirely.
		startShellTour( deps );
		await settle();
		primary().click();  // menus -> layout
		primary().click();  // layout: opens Preferences, advances itself
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'os-settings' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		// Swallowed once only: a window the user opens still counts.
		const win = fakeWindow( 'w3' );
		windows.set( 'w3', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w3' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
		expect( mark().anchor ).toBe( win.element );
	} );

	test( 'the boot gate yields to other announcements and the phone layer', () => {
		const base = { seenIntros: [] } as unknown as DesktopConfig;
		const desktop = (): boolean => false;
		expect( shouldAutoStartShellTour( base, desktop ) ).toBe( true );
		expect( shouldAutoStartShellTour( { ...base, shellTour: false }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( { ...base, seenIntros: [ 'shell-tour' ] }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( { ...base, rebrandNotice: true }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( { ...base, soloWindow: 'x' }, desktop ) ).toBe( false );
		expect(
			shouldAutoStartShellTour( { ...base, coreUpdate: { version: '7.1', url: 'u' } }, desktop ),
		).toBe( false );
		expect( shouldAutoStartShellTour( base, () => true ) ).toBe( false );
	} );

	test( 'a reset replays the tour even though the boot payload says it was seen', () => {
		vi.useFakeTimers();
		const start = vi.fn();
		( window as unknown as { openStationShellTour: unknown } ).openStationShellTour = {
			startShellTour: start,
			endShellTour: vi.fn(),
			isShellTourRunning: () => false,
		};
		installShellTour( {
			...deps,
			config: { ...deps.config, seenIntros: [ 'shell-tour' ] } as unknown as DesktopConfig,
			isMobile: () => false,
		} );
		vi.advanceTimersByTime( MOUNT_DELAY_MS + 10 );
		expect( start ).not.toHaveBeenCalled();

		document.dispatchEvent( new CustomEvent( 'os-intros-reset' ) );
		expect( start ).toHaveBeenCalledTimes( 1 );
		document.dispatchEvent( new CustomEvent( 'os-shell-tour-start' ) );
		expect( start ).toHaveBeenCalledTimes( 2 );
		delete ( window as unknown as { openStationShellTour?: unknown } ).openStationShellTour;
	} );
} );
