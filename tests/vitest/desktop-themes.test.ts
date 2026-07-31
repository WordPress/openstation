/**
 * Unit tests for `src/desktop-themes/` — the registry, the icon
 * resolver, the activation module, the slot maps, and the server
 * sync.
 *
 * The invariant worth defending hardest is the cheap path: with NO
 * active theme, `resolveThemedIcon()` must return `null` without
 * touching the hook bus, because it sits in front of every icon the
 * shell paints.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { FakeWpHooks } from './helpers/hooks-stub';
import { HOOKS } from '../../src/hooks';

import {
	getActiveDesktopThemeId,
	getDesktopTheme,
	getStore,
	listDesktopThemes,
	normalizeEntry,
	removeDesktopTheme,
	setDesktopThemes,
	subscribeDesktopThemes,
	upsertDesktopTheme,
} from '../../src/desktop-themes/registry';
import { resolveThemedIcon } from '../../src/desktop-themes/icons';
import {
	applyDesktopTheme,
	DESKTOP_THEME_CHANGED_EVENT,
} from '../../src/desktop-themes/apply';
import { createDesktopThemeSync } from '../../src/desktop-themes/server-sync';
import {
	DESKTOP_THEME_SLOTS,
	slotForFileType,
	slotForTileId,
	slotForWindowControl,
} from '../../src/desktop-themes/slots';

interface RawTheme {
	[ key: string ]: unknown;
}

function rawTheme( overrides: RawTheme = {} ): RawTheme {
	return {
		id: 'acme/neon',
		slug: 'acme-neon',
		name: 'Neon',
		version: '1.0.0',
		author: '',
		description: '',
		previewUrl: '',
		cssUrl: 'https://x.test/themes/acme-neon/theme.css?ver=1',
		cssText: '',
		tokens: {},
		icons: {},
		installedAt: 1,
		source: 'upload',
		...overrides,
	};
}

function mountShell(): HTMLElement {
	const shell = document.createElement( 'div' );
	shell.id = 'desktop-mode-shell';
	document.body.appendChild( shell );
	return shell;
}

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
	document.body.innerHTML = '';
	document.body.className = '';
	document.head.innerHTML = '';
	_resetAllSharedStoresForTests();
} );

afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
} );

// ---------------------------------------------------------------
// Registry.
// ---------------------------------------------------------------

describe( 'registry — normalization', () => {
	test( 'accepts a well-formed entry', () => {
		const entry = normalizeEntry( rawTheme() );
		expect( entry ).not.toBeNull();
		expect( entry!.slug ).toBe( 'acme-neon' );
		expect( entry!.source ).toBe( 'upload' );
	} );

	test( 'rejects entries with an unusable slug', () => {
		expect( normalizeEntry( null ) ).toBeNull();
		expect( normalizeEntry( 'nope' ) ).toBeNull();
		expect( normalizeEntry( rawTheme( { slug: '' } ) ) ).toBeNull();
		expect( normalizeEntry( rawTheme( { slug: 'Acme Neon' } ) ) ).toBeNull();
		expect( normalizeEntry( rawTheme( { slug: '../evil' } ) ) ).toBeNull();
	} );

	test( 'drops icon values that are not paintable', () => {
		// PHP validated these, but a `desktop_mode_desktop_themes`
		// filter runs after sanitization and can put anything in.
		const entry = normalizeEntry(
			rawTheme( {
				icons: {
					OK_DASHICON: 'dashicons-no-alt',
					OK_URL: 'https://x.test/a.svg',
					OK_DATA: 'data:image/svg+xml;base64,AAA',
					BAD_SCHEME: 'javascript:alert(1)',
					BAD_RELATIVE: '/icons/a.svg',
					BAD_EMPTY: '',
					BAD_TYPE: 42,
				},
			} ),
		);
		expect( Object.keys( entry!.icons ).sort() ).toEqual( [
			'OK_DASHICON',
			'OK_DATA',
			'OK_URL',
		] );
	} );

	test( 'caps the icon map', () => {
		const icons: Record< string, string > = {};
		for ( let i = 0; i < 200; i++ ) {
			icons[ `SLOT_${ i }` ] = 'dashicons-star-filled';
		}
		const entry = normalizeEntry( rawTheme( { icons } ) );
		expect( Object.keys( entry!.icons ).length ).toBe( 128 );
	} );
} );

describe( 'registry — CRUD', () => {
	test( 'seeds empty when the boot config has no themes', () => {
		expect( listDesktopThemes() ).toEqual( [] );
		expect( getActiveDesktopThemeId() ).toBeNull();
	} );

	test( 'setDesktopThemes replaces the library and skips bad entries', () => {
		setDesktopThemes( [ rawTheme(), { slug: '' }, rawTheme( { slug: 'other' } ) ] );
		expect( listDesktopThemes().map( ( t ) => t.slug ) ).toEqual( [
			'acme-neon',
			'other',
		] );
	} );

	test( 'getDesktopTheme resolves by slug or by full id', () => {
		setDesktopThemes( [ rawTheme() ] );
		expect( getDesktopTheme( 'acme-neon' )?.name ).toBe( 'Neon' );
		expect( getDesktopTheme( 'acme/neon' )?.name ).toBe( 'Neon' );
		expect( getDesktopTheme( 'missing' ) ).toBeNull();
		expect( getDesktopTheme( '' ) ).toBeNull();
	} );

	test( 'upsert inserts, replaces, and keeps the list name-sorted', () => {
		upsertDesktopTheme( rawTheme( { slug: 'zulu', name: 'Zulu' } ) );
		upsertDesktopTheme( rawTheme( { slug: 'alpha', name: 'Alpha' } ) );
		expect( listDesktopThemes().map( ( t ) => t.name ) ).toEqual( [
			'Alpha',
			'Zulu',
		] );

		upsertDesktopTheme( rawTheme( { slug: 'zulu', name: 'Zulu', version: '2' } ) );
		expect( listDesktopThemes() ).toHaveLength( 2 );
		expect( getDesktopTheme( 'zulu' )?.version ).toBe( '2' );
	} );

	test( 'upsert rejects malformed input without mutating', () => {
		setDesktopThemes( [ rawTheme() ] );
		expect( upsertDesktopTheme( { slug: '!!' } ) ).toBeNull();
		expect( listDesktopThemes() ).toHaveLength( 1 );
	} );

	test( 'remove drops one entry', () => {
		setDesktopThemes( [ rawTheme(), rawTheme( { slug: 'other' } ) ] );
		removeDesktopTheme( 'other' );
		expect( listDesktopThemes().map( ( t ) => t.slug ) ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'subscribers fire on mutation and can unsubscribe', () => {
		let calls = 0;
		const off = subscribeDesktopThemes( () => {
			calls += 1;
		} );
		setDesktopThemes( [ rawTheme() ] );
		expect( calls ).toBe( 1 );
		off();
		setDesktopThemes( [] );
		expect( calls ).toBe( 1 );
	} );
} );

// ---------------------------------------------------------------
// Resolver.
// ---------------------------------------------------------------

describe( 'resolveThemedIcon', () => {
	test( 'returns null with no active theme, without running the filter', () => {
		let filterRan = false;
		hooks.addFilter( HOOKS.DESKTOP_THEME_ICON, 'test', ( icon ) => {
			filterRan = true;
			return icon;
		} );

		setDesktopThemes( [ rawTheme( { icons: { OS_SETTINGS: 'dashicons-x' } } ) ] );

		expect( resolveThemedIcon( 'OS_SETTINGS' ) ).toBeNull();
		expect( filterRan ).toBe( false );
	} );

	test( 'returns the theme icon once active', () => {
		mountShell();
		setDesktopThemes( [
			rawTheme( { icons: { OS_SETTINGS: 'dashicons-admin-generic' } } ),
		] );
		applyDesktopTheme( 'acme-neon' );

		expect( resolveThemedIcon( 'OS_SETTINGS' ) ).toBe( 'dashicons-admin-generic' );
	} );

	test( 'returns null for a slot the active theme does not override', () => {
		mountShell();
		setDesktopThemes( [ rawTheme( { icons: { OS_SETTINGS: 'dashicons-x' } } ) ] );
		applyDesktopTheme( 'acme-neon' );

		expect( resolveThemedIcon( 'RECYCLE_BIN' ) ).toBeNull();
		expect( resolveThemedIcon( '' ) ).toBeNull();
	} );

	test( 'runs the icon filter while a theme is active', () => {
		mountShell();
		setDesktopThemes( [ rawTheme( { icons: { OS_SETTINGS: 'dashicons-x' } } ) ] );
		applyDesktopTheme( 'acme-neon' );

		const seen: Array< Record< string, unknown > > = [];
		hooks.addFilter(
			HOOKS.DESKTOP_THEME_ICON,
			'test',
			( icon, ctx ) => {
				seen.push( ctx as Record< string, unknown > );
				return 'https://x.test/override.svg';
			},
		);

		expect( resolveThemedIcon( 'OS_SETTINGS' ) ).toBe(
			'https://x.test/override.svg',
		);
		expect( seen[ 0 ] ).toEqual( { slot: 'OS_SETTINGS', themeId: 'acme-neon' } );
	} );

	test( 'a filter returning an empty string falls back to null', () => {
		mountShell();
		setDesktopThemes( [ rawTheme( { icons: { OS_SETTINGS: 'dashicons-x' } } ) ] );
		applyDesktopTheme( 'acme-neon' );
		hooks.addFilter( HOOKS.DESKTOP_THEME_ICON, 'test', () => '' );

		expect( resolveThemedIcon( 'OS_SETTINGS' ) ).toBeNull();
	} );
} );

// ---------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------

describe( 'applyDesktopTheme', () => {
	test( 'activating sets the attribute, body class, link, and state', () => {
		const shell = mountShell();
		setDesktopThemes( [ rawTheme() ] );

		applyDesktopTheme( 'acme-neon' );

		expect( shell.getAttribute( 'data-desktop-mode-desktop-theme' ) ).toBe(
			'acme-neon',
		);
		expect( document.body.classList.contains( 'desktop-mode-desktop-theme-acme-neon' ) ).toBe( true );

		const link = document.getElementById(
			'desktop-mode-desktop-theme-css',
		) as HTMLLinkElement | null;
		expect( link ).not.toBeNull();
		expect( link!.rel ).toBe( 'stylesheet' );
		expect( link!.href ).toContain( 'theme.css' );

		expect( getActiveDesktopThemeId() ).toBe( 'acme-neon' );
	} );

	test( 'a code theme injects a <style> instead of a <link>', () => {
		mountShell();
		setDesktopThemes( [
			rawTheme( {
				slug: 'code-theme',
				cssUrl: '',
				cssText: '.desktop-mode-shell { --x: 1px; }',
				source: 'code',
			} ),
		] );

		applyDesktopTheme( 'code-theme' );

		const style = document.querySelector(
			'style[data-desktop-mode-desktop-theme-css]',
		);
		expect( style ).not.toBeNull();
		expect( style!.textContent ).toContain( '--x: 1px;' );
	} );

	test( 'deactivating removes everything', () => {
		const shell = mountShell();
		setDesktopThemes( [ rawTheme() ] );
		applyDesktopTheme( 'acme-neon' );

		applyDesktopTheme( '' );

		expect( shell.hasAttribute( 'data-desktop-mode-desktop-theme' ) ).toBe( false );
		expect( document.body.className ).not.toContain( 'desktop-mode-desktop-theme-' );
		expect( document.getElementById( 'desktop-mode-desktop-theme-css' ) ).toBeNull();
		expect( getActiveDesktopThemeId() ).toBeNull();
		expect( getStore().state.activeIcons ).toBeNull();
	} );

	test( 'switching themes swaps the stylesheet rather than stacking', () => {
		mountShell();
		setDesktopThemes( [
			rawTheme(),
			rawTheme( { slug: 'other', cssUrl: 'https://x.test/other.css' } ),
		] );

		applyDesktopTheme( 'acme-neon' );
		applyDesktopTheme( 'other' );

		expect(
			document.querySelectorAll( 'link[id="desktop-mode-desktop-theme-css"]' ),
		).toHaveLength( 1 );
		expect( document.body.classList.contains( 'desktop-mode-desktop-theme-other' ) ).toBe( true );
		expect( document.body.classList.contains( 'desktop-mode-desktop-theme-acme-neon' ) ).toBe( false );
	} );

	test( 'an unknown id degrades to the system default', () => {
		const shell = mountShell();
		setDesktopThemes( [ rawTheme() ] );

		applyDesktopTheme( 'was-deleted' );

		expect( getActiveDesktopThemeId() ).toBeNull();
		expect( shell.hasAttribute( 'data-desktop-mode-desktop-theme' ) ).toBe( false );
	} );

	test( 'a redundant call is a no-op and fires no event', () => {
		mountShell();
		setDesktopThemes( [ rawTheme() ] );

		let events = 0;
		document.addEventListener( DESKTOP_THEME_CHANGED_EVENT, () => {
			events += 1;
		} );

		applyDesktopTheme( 'acme-neon' );
		applyDesktopTheme( 'acme-neon' );
		expect( events ).toBe( 1 );

		// Boot on the system default: two comparisons, no event.
		applyDesktopTheme( '' );
		expect( events ).toBe( 2 );
		applyDesktopTheme( '' );
		expect( events ).toBe( 2 );
	} );

	test( 'fires the CustomEvent and the hook action with themeId + previous', () => {
		mountShell();
		setDesktopThemes( [ rawTheme() ] );

		const eventDetails: unknown[] = [];
		document.addEventListener( DESKTOP_THEME_CHANGED_EVENT, ( e ) => {
			eventDetails.push( ( e as CustomEvent ).detail );
		} );
		const hookDetails: unknown[] = [];
		hooks.addAction( HOOKS.DESKTOP_THEME_CHANGED, 'test', ( detail ) => {
			hookDetails.push( detail );
		} );

		applyDesktopTheme( 'acme-neon' );
		applyDesktopTheme( '' );

		expect( eventDetails ).toEqual( [
			{ themeId: 'acme-neon', previous: null },
			{ themeId: null, previous: 'acme-neon' },
		] );
		expect( hookDetails ).toEqual( eventDetails );
	} );

	test( 'adopts a PHP-pre-stamped boot state instead of re-requesting', () => {
		// PHP stamps the attribute and prints the <link> before the
		// shell script runs; re-creating them would cause the exact
		// FOUC the server-side stamp exists to prevent.
		const shell = mountShell();
		shell.setAttribute( 'data-desktop-mode-desktop-theme', 'acme-neon' );
		const bootLink = document.createElement( 'link' );
		bootLink.id = 'desktop-mode-desktop-theme-css';
		bootLink.rel = 'stylesheet';
		bootLink.href = 'https://x.test/themes/acme-neon/theme.css?ver=1';
		document.head.appendChild( bootLink );

		setDesktopThemes( [ rawTheme() ] );
		applyDesktopTheme( 'acme-neon' );

		expect( document.getElementById( 'desktop-mode-desktop-theme-css' ) ).toBe(
			bootLink,
		);
		expect( getActiveDesktopThemeId() ).toBe( 'acme-neon' );
	} );

	test( 'a theme with no icon overrides publishes {} — never null', () => {
		// `null` is reserved for "no theme at all"; conflating the two
		// would make the resolver's fast path lie about an active theme.
		mountShell();
		setDesktopThemes( [ rawTheme( { icons: {} } ) ] );
		applyDesktopTheme( 'acme-neon' );

		expect( getStore().state.activeIcons ).toEqual( {} );
		expect( getStore().state.activeIcons ).not.toBeNull();
	} );

	test( 'works without a shell root (headless / early boot)', () => {
		setDesktopThemes( [ rawTheme() ] );
		expect( () => applyDesktopTheme( 'acme-neon' ) ).not.toThrow();
		expect( getActiveDesktopThemeId() ).toBe( 'acme-neon' );
	} );
} );

// ---------------------------------------------------------------
// Slots.
// ---------------------------------------------------------------

describe( 'slot maps', () => {
	test( 'system tiles map to their dedicated slots', () => {
		expect( slotForTileId( 'desktop-mode-os-settings' ) ).toBe(
			DESKTOP_THEME_SLOTS.OS_SETTINGS,
		);
		expect( slotForTileId( 'desktop-mode-recycle-bin' ) ).toBe(
			DESKTOP_THEME_SLOTS.RECYCLE_BIN,
		);
		expect( slotForTileId( 'desktop-mode-bug-report' ) ).toBe(
			DESKTOP_THEME_SLOTS.BUG_REPORT,
		);
		expect( slotForTileId( 'desktop-mode-exit' ) ).toBe(
			DESKTOP_THEME_SLOTS.EXIT_DESKTOP_MODE,
		);
		expect( slotForTileId( 'desktop-mode-pwa-install' ) ).toBe(
			DESKTOP_THEME_SLOTS.PWA_INSTALL,
		);
	} );

	test( 'everything else becomes APP:<slug>, sanitize_key-style', () => {
		expect( slotForTileId( 'edit-php' ) ).toBe( 'APP:edit-php' );
		expect( slotForTileId( 'Edit Php!' ) ).toBe( 'APP:editphp' );
		expect( slotForTileId( '' ) ).toBe( '' );
		expect( slotForTileId( '!!!' ) ).toBe( '' );
	} );

	test( 'built-in window controls map to their documented slots', () => {
		expect( slotForWindowControl( 'core/minimize' ) ).toBe(
			DESKTOP_THEME_SLOTS.WINDOW_CONTROL_MINIMIZE,
		);
		expect( slotForWindowControl( 'core/fullscreen-exit' ) ).toBe(
			DESKTOP_THEME_SLOTS.WINDOW_CONTROL_FULLSCREEN_EXIT,
		);
		expect( slotForWindowControl( 'core/close' ) ).toBe(
			DESKTOP_THEME_SLOTS.WINDOW_CONTROL_CLOSE,
		);
	} );

	test( 'vendor controls are upper-snaked from their full id', () => {
		expect( slotForWindowControl( 'acme/pin' ) ).toBe( 'WINDOW_CONTROL_ACME_PIN' );
		expect( slotForWindowControl( '' ) ).toBe( '' );
	} );

	test( 'file types map to FOLDER / FILE_* slots', () => {
		expect( slotForFileType( 'folder' ) ).toBe( DESKTOP_THEME_SLOTS.FOLDER );
		expect( slotForFileType( 'post' ) ).toBe( DESKTOP_THEME_SLOTS.FILE_POST );
		expect( slotForFileType( 'attachment' ) ).toBe(
			DESKTOP_THEME_SLOTS.FILE_ATTACHMENT,
		);
		// A plugin-registered file type has no slot of its own.
		expect( slotForFileType( 'acme-widget' ) ).toBe( '' );
		expect( slotForFileType( '' ) ).toBe( '' );
	} );
} );

// ---------------------------------------------------------------
// Server sync.
// ---------------------------------------------------------------

describe( 'createDesktopThemeSync', () => {
	test( 'replaces the library from the payload', () => {
		const sync = createDesktopThemeSync();
		sync( [ rawTheme(), rawTheme( { slug: 'other' } ) ] );
		expect( listDesktopThemes() ).toHaveLength( 2 );

		sync( [ rawTheme() ] );
		expect( listDesktopThemes().map( ( t ) => t.slug ) ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'tolerates a non-array payload', () => {
		const sync = createDesktopThemeSync();
		setDesktopThemes( [ rawTheme() ] );
		sync( undefined as unknown as unknown[] );
		expect( listDesktopThemes() ).toEqual( [] );
	} );

	test( 'deactivates when the ACTIVE theme leaves the payload', () => {
		mountShell();
		let deactivated = 0;
		const sync = createDesktopThemeSync( {
			deactivate: () => {
				deactivated += 1;
			},
		} );

		sync( [ rawTheme() ] );
		applyDesktopTheme( 'acme-neon' );

		sync( [ rawTheme( { slug: 'other' } ) ] );
		expect( deactivated ).toBe( 1 );
	} );

	test( 'leaves an active theme alone when it is still present', () => {
		mountShell();
		let deactivated = 0;
		const sync = createDesktopThemeSync( {
			deactivate: () => {
				deactivated += 1;
			},
		} );

		sync( [ rawTheme() ] );
		applyDesktopTheme( 'acme-neon' );
		sync( [ rawTheme( { version: '2' } ), rawTheme( { slug: 'other' } ) ] );

		expect( deactivated ).toBe( 0 );
	} );

	test( 'does nothing when no theme is active', () => {
		let deactivated = 0;
		const sync = createDesktopThemeSync( {
			deactivate: () => {
				deactivated += 1;
			},
		} );
		sync( [] );
		expect( deactivated ).toBe( 0 );
	} );
} );
