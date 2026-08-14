/**
 * Wallpaper shortcuts and the native-window remap registry.
 *
 * A shortcut placement knows only a URL. The Spatial layout
 * synthesizes one for every core dock item
 * (`settings/desktop-shortcuts-sync.ts` → `file.shortcutUrl`), so the
 * wallpaper tile for Posts and the dock tile for Posts start from the
 * same `edit.php` — but the dock asks `tryNativeUrlRemap()` first and
 * the shortcut opener did not. A user who had explicitly enabled
 * native Posts, Pages, Comments, Plugins or Users got the classic
 * iframe from the wallpaper and the native app from the dock: same
 * app, two answers, depending on which surface they clicked.
 *
 * The contract pinned here is that the shortcut opener consults the
 * registry, and — just as importantly — that it still falls through
 * to the iframe when the registry's `enabled` gate says the native
 * window is off. The gate reads the live OS Settings snapshot, so
 * this is what makes the feature toggle keep working.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type Modules = {
	openers: typeof import( '../../src/desktop-files/openers' );
	builtIn: typeof import( '../../src/desktop-files/built-in-openers' );
	file: typeof import( '../../src/desktop-files/file' );
	remap: typeof import( '../../src/native-url-remap' );
};

// Must be same-origin with jsdom's document, or the opener sends
// the URL to a new browser tab before any remap is consulted.
const ADMIN_URL = `${ window.location.origin }/wp-admin/`;

async function load(): Promise< Modules > {
	vi.resetModules();
	return {
		openers: await import( '../../src/desktop-files/openers' ),
		builtIn: await import( '../../src/desktop-files/built-in-openers' ),
		file: await import( '../../src/desktop-files/file' ),
		remap: await import( '../../src/native-url-remap' ),
	};
}

/** A synthesized dock-item promotion, as Spatial puts on the wallpaper. */
function shortcutFile(
	url: string,
	mod: Modules[ 'file' ],
): InstanceType< typeof mod.DefaultDesktopFile > {
	return new mod.DefaultDesktopFile(
		{
			type: 'shortcut',
			ref: 'dock-promoted:edit-php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			previewUrl: '',
			exists: true,
			shortcutUrl: url,
		} as unknown as ConstructorParameters<
			typeof mod.DefaultDesktopFile
		>[ 0 ],
		'shortcut',
	);
}

let windowManagerOpen: ReturnType< typeof vi.fn >;
let openWindow: ReturnType< typeof vi.fn >;

function installShellApi(): void {
	windowManagerOpen = vi.fn();
	openWindow = vi.fn();
	( window as unknown as { wp?: Record< string, unknown > } ).wp = {
		...( ( window as unknown as { wp?: Record< string, unknown > } ).wp ??
			{} ),
		os: {
			openWindow,
			windowManager: { open: windowManagerOpen },
			config: { adminUrl: ADMIN_URL },
		},
	};
}

/** Register the Posts remap, gated on the native-Posts preference. */
function registerPostsRemap(
	mod: Modules[ 'remap' ],
	enabled: boolean,
): ReturnType< typeof vi.fn > {
	const openById = vi.fn().mockReturnValue( true );
	mod.bindNativeUrlRemap( {
		getSnapshot: () =>
			( { nativePostsEnabled: enabled } ) as unknown as ReturnType<
				Parameters< typeof mod.bindNativeUrlRemap >[ 0 ][ 'getSnapshot' ]
			>,
		openById,
		adminUrl: ADMIN_URL,
	} );
	mod.registerNativeUrlRemap( {
		id: 'desktop-mode-posts',
		nativeWindowId: 'desktop-mode-posts',
		matches: ( _url, parsed ) =>
			parsed.pathname.endsWith( '/edit.php' ) &&
			! parsed.searchParams.has( 'post_type' ),
		enabled: ( s: { nativePostsEnabled?: boolean } ) =>
			s.nativePostsEnabled === true,
	} );
	return openById;
}

/** Run the built-in shortcut opener against a file. */
function openShortcut( mods: Modules, url: string ): void {
	mods.builtIn.registerBuiltInFileOpeners();
	const opener = mods.openers.getOpener( 'desktop-mode-shortcut-opener' );
	expect( opener ).not.toBeNull();
	const handler = opener!.handler as {
		kind: 'js';
		open: ( f: unknown ) => void;
	};
	handler.open( shortcutFile( url, mods.file ) );
}

describe( 'wallpaper shortcut → native window', () => {
	beforeEach( () => {
		installHooksStub();
		installShellApi();
	} );

	afterEach( async () => {
		const { remap } = await load();
		remap._resetNativeUrlRemap();
		clearHooksStub();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'an enabled native window claims the URL', async () => {
		const mods = await load();
		installShellApi();
		const openById = registerPostsRemap( mods.remap, true );

		openShortcut( mods, `${ ADMIN_URL }edit.php` );

		expect( openById ).toHaveBeenCalledWith( 'desktop-mode-posts' );
		// The whole point: no classic iframe alongside (or instead of)
		// the native app.
		expect( windowManagerOpen ).not.toHaveBeenCalled();

		mods.remap._resetNativeUrlRemap();
	} );

	test( 'a disabled native window still falls through to the iframe', async () => {
		const mods = await load();
		installShellApi();
		const openById = registerPostsRemap( mods.remap, false );

		openShortcut( mods, `${ ADMIN_URL }edit.php` );

		expect( openById ).not.toHaveBeenCalled();
		expect( windowManagerOpen ).toHaveBeenCalledTimes( 1 );
		expect(
			( windowManagerOpen.mock.calls[ 0 ][ 0 ] as { url: string } ).url,
		).toBe( `${ ADMIN_URL }edit.php` );

		mods.remap._resetNativeUrlRemap();
	} );

	test( 'a URL no remap claims opens the iframe as before', async () => {
		const mods = await load();
		installShellApi();
		registerPostsRemap( mods.remap, true );

		openShortcut( mods, `${ ADMIN_URL }options-general.php` );

		expect( windowManagerOpen ).toHaveBeenCalledTimes( 1 );

		mods.remap._resetNativeUrlRemap();
	} );

	test( 'a shortcut that names a native window directly is untouched', async () => {
		const mods = await load();
		installShellApi();
		registerPostsRemap( mods.remap, true );
		mods.builtIn.registerBuiltInFileOpeners();

		const opener = mods.openers.getOpener( 'desktop-mode-shortcut-opener' );
		const handler = opener!.handler as {
			kind: 'js';
			open: ( f: unknown ) => void;
		};
		handler.open(
			new mods.file.DefaultDesktopFile(
				{
					type: 'shortcut',
					ref: 'desktop-mode-recycle-bin',
					title: 'Recycle Bin',
					icon: 'dashicons-trash',
					previewUrl: '',
					exists: true,
					shortcutWindow: 'desktop-mode-recycle-bin',
				} as unknown as ConstructorParameters<
					typeof mods.file.DefaultDesktopFile
				>[ 0 ],
				'shortcut',
			),
		);

		expect( openWindow ).toHaveBeenCalledWith( 'desktop-mode-recycle-bin' );
		expect( windowManagerOpen ).not.toHaveBeenCalled();

		mods.remap._resetNativeUrlRemap();
	} );
} );
