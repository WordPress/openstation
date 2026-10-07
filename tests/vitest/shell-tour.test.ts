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

function fakeWindow(
	id: string,
	snapped = false,
): ShellTourWindowLike & {
	snapTo: ReturnType< typeof vi.fn >;
	unsnap: ReturnType< typeof vi.fn >;
} {
	const element = document.createElement( 'div' );
	element.className = 'os-window';
	document.body.appendChild( element );
	let isSnapped = snapped;
	const unsnap = vi.fn( () => {
		isSnapped = false;
	} );
	return { id, element, snapTo: vi.fn(), isSnapped: () => isSnapped, unsnap };
}

describe( 'shell tour', () => {
	let hooks: FakeWpHooks;
	let fetchSpy: ReturnType< typeof vi.fn >;
	let windows: Map< string, ShellTourWindowLike >;
	let deps: ShellTourDeps & {
		openPalette: ReturnType< typeof vi.fn >;
		openFallbackWindow: ReturnType< typeof vi.fn >;
		openLayoutSettings: ReturnType< typeof vi.fn >;
		closeWindow: ReturnType< typeof vi.fn >;
		closePalette: ReturnType< typeof vi.fn >;
		refreshDesktopIcons: ReturnType< typeof vi.fn >;
	};

	let layoutTarget: Element | null;

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
			openLayoutSettings: vi.fn( () => ( {
				windowId: 'os-settings',
				wasAlreadyOpen: false,
			} ) ),
			findLayoutTarget: () => layoutTarget,
			closeWindow: vi.fn(),
			closePalette: vi.fn(),
			refreshDesktopIcons: vi.fn(),
		};
		layoutTarget = null;
	} );
	afterEach( () => {
		endShellTour();
		document.body.innerHTML = '';
		clearHooksStub();
		vi.useRealTimers();
	} );

	const mark = (): OsCoachmark => document.querySelector( 'os-coachmark' ) as OsCoachmark;

	const posted = (): string[] =>
		fetchSpy.mock.calls.map(
			( [ , init ] ) => ( JSON.parse( String( ( init as RequestInit ).body ) ) as { slug: string } ).slug,
		);
	const primary = (): HTMLElement =>
		mark().shadowRoot!.querySelector< HTMLElement >( 'os-button.primary' )!;

	const skipIntroCards = (): void => {
		primary().click();
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
		await settle();
		const [ url ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( 'https://example.test/wp-json/desktop-mode/v1/intros/seen' );

		expect( posted() ).toEqual( [ SHELL_TOUR_INTRO_SLUG, 'shell-tour-done' ] );
		expect( deps.refreshDesktopIcons ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'Skip records the tour as unfinished, once; a later Escape does not post again', async () => {
		startShellTour( deps );
		await settle();
		const m = mark();
		m.shadowRoot!.querySelector< HTMLElement >( 'os-button.secondary' )!.click();
		await settle();

		expect( posted() ).toEqual( [ SHELL_TOUR_INTRO_SLUG, 'shell-tour-skipped' ] );
		expect( deps.refreshDesktopIcons ).toHaveBeenCalledTimes( 1 );

		m.shadowRoot!
			.querySelector< HTMLElement >( '.card' )!
			.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		endShellTour();
		await settle();
		expect( posted() ).toHaveLength( 2 );
	} );

	test( '"Do it for me" snaps the opened window and opens the palette through the shell', async () => {
		startShellTour( deps );
		await settle();
		skipIntroCards();
		const win = fakeWindow( 'w2' );
		windows.set( 'w2', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w2' } );

		primary().click();
		expect( win.snapTo ).toHaveBeenCalledWith( 'left' );
		expect( mark().getAttribute( 'step' ) ).toBe( '5' );

		primary().click();
		expect( deps.openPalette ).toHaveBeenCalledTimes( 1 );
		expect( mark().hasAttribute( 'step' ) ).toBe( false );
	} );

	test( 'step 1 also advances when the screen was already open (reopen, not open)', async () => {

		startShellTour( deps );
		await settle();
		skipIntroCards();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		const win = fakeWindow( 'w9' );
		windows.set( 'w9', win );
		hooks.doAction( HOOKS.WINDOW_REOPENED, { windowId: 'w9' } );

		expect( mark().getAttribute( 'step' ) ).toBe( '4' );

		expect( mark().anchor ).toBe( win.element );
	} );

	test( '"Do it for me" on the open-window card activates the dock tile\'s primary button, else the fallback', async () => {

		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.innerHTML =
			'<div class="os-dock__item" data-nav-id="menu-posts"><button class="os-dock__item-primary">Posts</button></div>';
		document.body.appendChild( dock );
		const opened = vi.fn();
		dock.querySelector( '.os-dock__item-primary' )!.addEventListener( 'click', opened );

		startShellTour( deps );
		await settle();

		expect( mark().anchor ).toBe( dock );
		skipIntroCards();
		expect( mark().anchor ).toBe( dock.querySelector( '.os-dock__item' ) );
		primary().click();
		expect( opened ).toHaveBeenCalledTimes( 1 );
		expect( deps.openFallbackWindow ).not.toHaveBeenCalled();

		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		endShellTour();
		dock.remove();
		startShellTour( deps );
		await settle();

		const latest = (): HTMLElement => {
			const marks = document.querySelectorAll< OsCoachmark >( 'os-coachmark' );
			return marks[ marks.length - 1 ].shadowRoot!.querySelector< HTMLElement >(
				'os-button.primary',
			)!;
		};
		latest().click();
		latest().click();
		latest().click();
		latest().click();
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

		expect( deps.findLayoutTarget ).toBeDefined();

		const systemTile = document.createElement( 'div' );
		document.body.appendChild( systemTile );
		layoutTarget = systemTile;

		primary().click();
		expect( mark().getAttribute( 'heading' ) ).toBe( 'Configure the layout as you wish' );
		expect( mark().anchor ).toBe( systemTile );
		expect( mark().getAttribute( 'primary-label' ) ).toBe( 'Show me' );
		expect( deps.openLayoutSettings ).not.toHaveBeenCalled();

		const section = document.createElement( 'div' );
		document.body.appendChild( section );
		layoutTarget = section;
		primary().click();
		expect( deps.openLayoutSettings ).toHaveBeenCalledTimes( 1 );
		expect( mark().getAttribute( 'step' ) ).toBe( '2' );
		expect( mark().anchor ).toBe( section );
		expect( mark().getAttribute( 'primary-label' ) ).toBe( 'Next' );

		primary().click();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );
		expect( mark().getAttribute( 'heading' ) ).toBe( 'Open a window' );
	} );

	test( 'the window the layout card opens does not complete the card after it', async () => {

		startShellTour( deps );
		await settle();
		skipIntroCards();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'os-settings' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		const win = fakeWindow( 'w3' );
		windows.set( 'w3', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w3' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
		expect( mark().anchor ).toBe( win.element );
	} );

	test( 'a window already snapped to the edge is floated before the snap card', async () => {

		startShellTour( deps );
		await settle();
		skipIntroCards();

		const win = fakeWindow( 'w4', true );
		windows.set( 'w4', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w4' } );

		expect( mark().getAttribute( 'heading' ) ).toBe( 'Snap it to the side' );
		expect( win.unsnap ).toHaveBeenCalledTimes( 1 );

		primary().click();
		expect( win.snapTo ).toHaveBeenCalledWith( 'left' );
	} );

	test( 'a window that was NOT snapped is left alone', async () => {
		startShellTour( deps );
		await settle();
		skipIntroCards();

		const win = fakeWindow( 'w5' );
		windows.set( 'w5', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w5' } );

		expect( win.unsnap ).not.toHaveBeenCalled();
	} );

	test( 'ending closes what the tour opened, and nothing else', async () => {
		startShellTour( deps );
		await settle();
		primary().click();
		primary().click();
		windows.set( 'os-settings', fakeWindow( 'os-settings' ) );
		primary().click();

		const theirs = fakeWindow( 'theirs' );
		windows.set( 'theirs', theirs );
		hooks.doAction( HOOKS.WINDOW_REOPENED, { windowId: 'theirs' } );
		hooks.doAction( HOOKS.SNAP_ZONE_COMMITTED, { windowId: 'theirs', zone: 'left' } );
		document.dispatchEvent( new CustomEvent( 'os-palette-opened', { detail: { id: 'x' } } ) );

		await settle();
		primary().click();
		expect( isShellTourRunning() ).toBe( false );

		const closed = deps.closeWindow.mock.calls.map( ( c ) => c[ 0 ] );

		expect( closed ).toEqual( [ 'os-settings' ] );
		expect( closed ).not.toContain( 'theirs' );
		expect( deps.closePalette ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the layout card closes Preferences when it is done, once, even one the user had', async () => {

		deps.openLayoutSettings = vi.fn( () => ( {
			windowId: 'os-settings',
			wasAlreadyOpen: true,
		} ) );
		startShellTour( deps );
		await settle();
		primary().click();
		primary().click();
		expect( deps.closeWindow ).not.toHaveBeenCalled();

		primary().click();
		expect( deps.closeWindow ).toHaveBeenCalledWith( 'os-settings' );

		endShellTour();
		expect( deps.closeWindow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the layout card waits for the section, not just for any target', async () => {

		const systemTile = document.createElement( 'div' );
		const section = document.createElement( 'div' );
		document.body.append( systemTile, section );
		layoutTarget = systemTile;

		startShellTour( deps );
		await settle();
		primary().click();
		primary().click();
		expect( mark().anchor ).toBe( systemTile );

		layoutTarget = section;
		await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
		await settle();
		expect( mark().anchor ).toBe( section );
	} );

	test( 'Mío walks the tour: summoned, following each balloon, released at the end', async () => {
		const mio = { size: () => 112, summon: vi.fn(), follow: vi.fn(), release: vi.fn() };
		deps.mio = mio;
		startShellTour( deps );
		await settle();
		expect( mio.summon ).toHaveBeenCalledTimes( 1 );

		expect( mark().getAttribute( 'speaker-size' ) ).toBe( '112' );

		mark().dispatchEvent( new CustomEvent( 'os-coachmark-speaker', { detail: { x: 40, y: 50 } } ) );
		expect( mio.follow ).toHaveBeenLastCalledWith( { x: 40, y: 50 } );

		startShellTour( deps );
		expect( mio.release ).not.toHaveBeenCalled();

		endShellTour();
		expect( mio.release ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'without a Mío on this screen the cards stay plain', async () => {
		deps.mio = { size: () => 0, summon: vi.fn(), follow: vi.fn(), release: vi.fn() };
		startShellTour( deps );
		await settle();

		expect( mark().hasAttribute( 'speaker-size' ) ).toBe( false );
		expect( deps.mio.summon ).not.toHaveBeenCalled();
	} );

	test( 'the closing card goes under the assistant, once its panel has painted', async () => {

		let panel: Element | null = null;
		deps.findAssistant = () => panel;
		deps.mio = { size: () => 112, summon: vi.fn(), follow: vi.fn(), release: vi.fn() };
		startShellTour( deps );
		await settle();
		expect( mark().getAttribute( 'speaker-size' ) ).toBe( '112' );
		skipIntroCards();
		const win = fakeWindow( 'w6' );
		windows.set( 'w6', win );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'w6' } );
		hooks.doAction( HOOKS.SNAP_ZONE_COMMITTED, { windowId: 'w6', zone: 'left' } );

		expect( mark().hasAttribute( 'placement' ) ).toBe( false );

		document.dispatchEvent( new CustomEvent( 'os-palette-opened', { detail: { id: 'x' } } ) );
		expect( mark().getAttribute( 'heading' ) ).toBe( 'You are set' );
		expect( mark().getAttribute( 'placement' ) ).toBe( 'bottom' );

		expect( mark().hasAttribute( 'speaker-size' ) ).toBe( false );
		expect( mark().anchor ).toBeNull();

		panel = document.createElement( 'div' );
		document.body.appendChild( panel );
		await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
		expect( mark().anchor ).toBe( panel );
	} );

	test( 'a window the user opened is theirs to keep; one "Do it for me" opened is closed', async () => {

		startShellTour( deps );
		await settle();
		skipIntroCards();
		windows.set( 'mine', fakeWindow( 'mine' ) );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'mine' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
		mark().shadowRoot!.querySelector< HTMLElement >( 'os-button.secondary' )!.click();
		expect( isShellTourRunning() ).toBe( false );
		expect( deps.closeWindow.mock.calls.map( ( c ) => c[ 0 ] ) ).not.toContain( 'mine' );

		deps.closeWindow.mockClear();
		startShellTour( deps );
		await settle();
		const marks = document.querySelectorAll< OsCoachmark >( 'os-coachmark' );
		const latest = marks[ marks.length - 1 ];
		const press = ( which: 'primary' | 'secondary' ): void =>
			latest.shadowRoot!.querySelector< HTMLElement >( `os-button.${ which }` )!.click();
		press( 'primary' );
		press( 'primary' );
		press( 'primary' );
		press( 'primary' );
		windows.set( 'tours', fakeWindow( 'tours' ) );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'tours' } );
		press( 'secondary' );
		expect( deps.closeWindow.mock.calls.map( ( c ) => c[ 0 ] ) ).toContain( 'tours' );
	} );

	test( 'Preferences landing while its own card is up does not eat a later open of it', async () => {

		startShellTour( deps );
		await settle();
		primary().click();
		primary().click();
		windows.set( 'os-settings', fakeWindow( 'os-settings' ) );
		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'os-settings' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '2' );
		primary().click();
		expect( mark().getAttribute( 'step' ) ).toBe( '3' );

		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'os-settings' } );
		expect( mark().getAttribute( 'step' ) ).toBe( '4' );
	} );

	test( 'the boot gate yields to other announcements and the phone layer', () => {
		const base = { seenIntros: [] } as unknown as DesktopConfig;
		const desktop = (): boolean => false;
		expect( shouldAutoStartShellTour( base, desktop ) ).toBe( true );
		expect( shouldAutoStartShellTour( { ...base, shellTour: false }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( { ...base, seenIntros: [ 'shell-tour' ] }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( { ...base, rebrandNotice: true }, desktop ) ).toBe( false );

		const feedback = { restUrl: 'u' };
		expect( shouldAutoStartShellTour( { ...base, usageFeedback: feedback }, desktop ) ).toBe( false );
		expect(
			shouldAutoStartShellTour(
				{ ...base, usageFeedback: feedback, seenIntros: [ 'usage-feedback' ] },
				desktop,
			),
		).toBe( true );
		expect( shouldAutoStartShellTour( { ...base, soloWindow: 'x' }, desktop ) ).toBe( false );
		expect( shouldAutoStartShellTour( base, () => true ) ).toBe( false );
	} );

	test( 'the first-boot start yields to the core-update notice only when it showed something', async () => {

		vi.useFakeTimers();
		const start = vi.fn();
		( window as unknown as { openStationShellTour: unknown } ).openStationShellTour = {
			startShellTour: start,
			endShellTour: vi.fn(),
			isShellTourRunning: () => false,
		};
		const boot = ( updateNoticeShown: Promise< boolean > ): ( () => void ) =>
			installShellTour( {
				...deps,
				config: { ...deps.config, seenIntros: [] } as unknown as DesktopConfig,
				isMobile: () => false,
				updateNoticeShown,
			} );

		const shown = boot( Promise.resolve( true ) );
		await vi.advanceTimersByTimeAsync( MOUNT_DELAY_MS + 10 );
		expect( start ).not.toHaveBeenCalled();
		shown();

		const nothingShown = boot( Promise.resolve( false ) );
		await vi.advanceTimersByTimeAsync( MOUNT_DELAY_MS + 10 );
		expect( start ).toHaveBeenCalledTimes( 1 );
		nothingShown();
		delete ( window as unknown as { openStationShellTour?: unknown } ).openStationShellTour;
	} );

	test( 'no route starts the tour on the phone layer, and a flip to it ends a running one', () => {

		const start = vi.fn();
		const end = vi.fn();
		( window as unknown as { openStationShellTour: unknown } ).openStationShellTour = {
			startShellTour: start,
			endShellTour: end,
			isShellTourRunning: () => false,
		};
		let mobile = true;
		const uninstall = installShellTour( {
			...deps,
			config: { ...deps.config, seenIntros: [ 'shell-tour' ] } as unknown as DesktopConfig,
			isMobile: () => mobile,
		} );
		document.dispatchEvent( new CustomEvent( 'os-shell-tour-start' ) );
		document.dispatchEvent( new CustomEvent( 'os-intros-reset' ) );
		hooks.doAction( HOOKS.DESKTOP_ICON_CLICKED, { id: 'openstation-shell-tour' } );
		expect( start ).not.toHaveBeenCalled();

		mobile = false;
		document.dispatchEvent( new CustomEvent( 'os-shell-tour-start' ) );
		expect( start ).toHaveBeenCalledTimes( 1 );

		hooks.doAction( HOOKS.MODE_CHANGED, { mode: 'tablet', previous: 'desktop' } );
		expect( end ).not.toHaveBeenCalled();
		hooks.doAction( HOOKS.MODE_CHANGED, { mode: 'mobile', previous: 'tablet' } );
		expect( end ).toHaveBeenCalledTimes( 1 );
		uninstall();
		delete ( window as unknown as { openStationShellTour?: unknown } ).openStationShellTour;
	} );

	test( 'a reset replays the tour even though the boot payload says it was seen', () => {
		vi.useFakeTimers();
		const start = vi.fn();
		( window as unknown as { openStationShellTour: unknown } ).openStationShellTour = {
			startShellTour: start,
			endShellTour: vi.fn(),
			isShellTourRunning: () => false,
		};
		const uninstall = installShellTour( {
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
		uninstall();
		delete ( window as unknown as { openStationShellTour?: unknown } ).openStationShellTour;
	} );
} );
