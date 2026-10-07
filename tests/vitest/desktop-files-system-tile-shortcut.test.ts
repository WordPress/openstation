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
			...( window as unknown as { wp: object } ).wp,
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

		expect( openWindow ).not.toHaveBeenCalled();
	} );

	test( 'announces the click, so an icon with nothing to open still answers', async () => {

		const hooks = installHooksStub();
		const { openers, builtins, file } = await loadOpeners();
		builtins.registerBuiltInFileOpeners();
		const openWindow = vi.fn();
		( window as unknown as { wp: { os: unknown } } ).wp = {
			...( window as unknown as { wp: object } ).wp,
			os: { openWindow, getSystemTile: () => null },
		};
		const clicked = vi.fn();
		hooks.addAction( 'os.os-icon.clicked', 'test', clicked );

		const opener = openers.getOpener( 'desktop-mode-shortcut-opener' );
		const shape = {
			type: 'shortcut',
			ref: 'openstation-shell-tour',
			title: 'Take the tour',
			icon: 'dashicons-welcome-learn-more',
			previewUrl: '',
			exists: true,
			shortcutWindow: '',
			shortcutUrl: '',
		};
		( opener!.handler as { open: ( f: unknown ) => void } ).open(
			new file.DefaultDesktopFile( shape as never, 'shortcut' ),
		);

		expect( clicked ).toHaveBeenCalledWith( expect.objectContaining( { id: 'openstation-shell-tour' } ) );
		expect( openWindow ).not.toHaveBeenCalled();
	} );
} );
