/**
 * The wallpaper copy of a system tile has to BE the tile.
 *
 * Two halves, and they only work together:
 *
 * 1. The shortcut opener runs the tile's own `onOpen`, so a tile that
 *    toggles something (Mio) behaves the same on both surfaces as one
 *    that opens a window (the Trash).
 * 2. The placement's `ref` is the bare tile id, which
 *    `nav-desktop-sync.test.ts` pins. Three lookups in the files layer
 *    and the dock find the bin by
 *    `file.ref === 'desktop-mode-recycle-bin'` — the drag-to-trash drop
 *    target, the drop-rejection exemption, and the empty/full art swap.
 *    Prefixing it turned the wallpaper bin into a tile that refused
 *    every drop and never filled up.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type OpenersModule = typeof import( '../../src/desktop-files/openers' );
type BuiltInsModule = typeof import( '../../src/desktop-files/built-in-openers' );
type FileModule = typeof import( '../../src/desktop-files/file' );

async function loadOpeners(): Promise< {
	openers: OpenersModule;
	builtins: BuiltInsModule;
	file: FileModule;
} > {
	vi.resetModules();
	return {
		openers: await import( '../../src/desktop-files/openers' ),
		builtins: await import( '../../src/desktop-files/built-in-openers' ),
		file: await import( '../../src/desktop-files/file' ),
	};
}

describe( 'the shortcut opener, on a promoted system tile', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'runs the tile’s own onOpen rather than deriving a window', async () => {
		const { openers, builtins, file } = await loadOpeners();
		builtins.registerBuiltInFileOpeners();

		const onOpen = vi.fn();
		const openWindow = vi.fn();
		( window as unknown as { wp: { os: unknown } } ).wp = {
			os: {
				getSystemTile: ( id: string ) =>
					id === 'os-mio-toggle' ? { onOpen } : null,
				openWindow,
			},
		};

		const opener = openers.getOpener( 'desktop-mode-shortcut-opener' );
		expect( opener ).not.toBeNull();

		const shape = {
			type: 'shortcut',
			ref: 'os-mio-toggle',
			title: 'Mio',
			icon: 'dashicons-superhero-alt',
			previewUrl: '',
			exists: true,
			shortcutSystemTile: 'os-mio-toggle',
		};
		( opener!.handler as { open: ( f: unknown ) => void } ).open(
			new file.DefaultDesktopFile( shape as never, 'shortcut' ),
		);

		expect( onOpen ).toHaveBeenCalledTimes( 1 );
		// Mio has no window; deriving one would have opened nothing.
		expect( openWindow ).not.toHaveBeenCalled();
	} );
} );
