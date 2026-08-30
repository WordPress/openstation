/**
 * Tests for the "close all windows" chord (`Ctrl/Cmd + Alt + W`):
 * which key combinations claim it, that it routes through
 * `WindowManager.closeAll()` behind a confirmation, and that the
 * chromeless bridge's forwarded `os-window-close-all` message reaches
 * the same path a local keypress does.
 *
 * `osConfirm` is mocked — the real one lazy-loads the shell-overlays
 * bundle over the network, which jsdom has no business fetching.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';

interface ConfirmArgs {
	rememberLabel?: string;
	onRemember?: ( remember: boolean ) => void;
}

const confirmMock = vi.fn< ( options: ConfirmArgs ) => Promise< boolean > >();
const toastMock = vi.fn();

vi.mock( '../../src/os-confirm', () => ( {
	osConfirm: ( options: ConfirmArgs ) => confirmMock( options ),
} ) );
vi.mock( '../../src/toast', () => ( {
	showToast: ( options: unknown ) => {
		toastMock( options );
		return () => undefined;
	},
} ) );

import { WindowManager } from '../../src/window-manager';
import {
	CLOSE_ALL_MESSAGE,
	closeAllWindows,
	installCloseAllShortcut,
	isCloseAllChord,
} from '../../src/window-manager/close-all-shortcut';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

function chord( init: Partial< KeyboardEventInit > & { code?: string } = {} ) {
	return new KeyboardEvent( 'keydown', {
		code: 'KeyW',
		ctrlKey: true,
		altKey: true,
		bubbles: true,
		cancelable: true,
		...init,
	} );
}

describe( 'close-all shortcut — chord matching', () => {
	test( 'claims Ctrl+Alt+W and Cmd+Alt+W', () => {
		expect( isCloseAllChord( chord() ) ).toBe( true );
		expect(
			isCloseAllChord( chord( { ctrlKey: false, metaKey: true } ) ),
		).toBe( true );
	} );

	test( 'ignores near misses', () => {
		// No Alt — that is the browser's own close-window chord.
		expect( isCloseAllChord( chord( { altKey: false } ) ) ).toBe( false );
		// No Ctrl/Cmd — bare Alt+W is a menu mnemonic on Windows.
		expect( isCloseAllChord( chord( { ctrlKey: false } ) ) ).toBe( false );
		// Shift excluded rather than ignored.
		expect( isCloseAllChord( chord( { shiftKey: true } ) ) ).toBe( false );
		// Another key entirely.
		expect( isCloseAllChord( chord( { code: 'KeyQ' } ) ) ).toBe( false );
	} );

	test( 'reads the physical key, not the typed character', () => {
		// Option+W on macOS types `∑`; `code` stays KeyW.
		const e = new KeyboardEvent( 'keydown', {
			code: 'KeyW',
			key: '∑',
			metaKey: true,
			altKey: true,
		} );
		expect( isCloseAllChord( e ) ).toBe( true );
	} );
} );

describe( 'close-all shortcut — closing', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		void hooks;
		confirmMock.mockReset();
		confirmMock.mockResolvedValue( true );
		toastMock.mockReset();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktopArea, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		manager.destroy();
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'closes every window once confirmed', async () => {
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );

		const closed = await closeAllWindows( manager );

		expect( closed ).toBe( 2 );
		expect( manager.getAll() ).toHaveLength( 0 );
		expect( confirmMock ).toHaveBeenCalledTimes( 1 );
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'cancelling leaves every window open', async () => {
		confirmMock.mockResolvedValue( false );
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );

		expect( await closeAllWindows( manager ) ).toBe( 0 );
		expect( manager.getAll() ).toHaveLength( 2 );
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'asks nothing when no window is open', async () => {
		expect( await closeAllWindows( manager ) ).toBe( 0 );
		expect( confirmMock ).not.toHaveBeenCalled();
	} );

	test( 'a repeat while the dialog is up does not stack a second one', async () => {
		await manager.open( openConfig( 'a' ) );
		let release: ( ok: boolean ) => void = () => undefined;
		confirmMock.mockImplementation(
			() =>
				new Promise< boolean >( ( resolve ) => {
					release = resolve;
				} ),
		);

		const first = closeAllWindows( manager );
		expect( await closeAllWindows( manager ) ).toBe( 0 );
		expect( confirmMock ).toHaveBeenCalledTimes( 1 );

		release( true );
		expect( await first ).toBe( 1 );
	} );

	test( 'the protection filter still wins', async () => {
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		window.wp?.hooks?.addFilter(
			'os.windows.close-all',
			'test/keep-a',
			( windows: unknown ) =>
				( windows as { id: string }[] ).filter( ( w ) => w.id !== 'a' ),
		);

		expect( await closeAllWindows( manager ) ).toBe( 1 );
		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'a' ] );
	} );

	test( 'the dialog offers "don\'t ask again" only when there is a store', async () => {
		await manager.open( openConfig( 'a' ) );

		await closeAllWindows( manager );
		expect( confirmMock.mock.calls[ 0 ][ 0 ].rememberLabel ).toBeUndefined();

		await manager.open( openConfig( 'b' ) );
		await closeAllWindows( manager, {
			shouldAsk: () => true,
			setAsk: () => undefined,
		} );
		expect( confirmMock.mock.calls[ 1 ][ 0 ].rememberLabel ).toBeTruthy();
	} );

	test( 'ticking the box persists "do not ask", and only on confirm', async () => {
		const setAsk = vi.fn();
		const prefs = { shouldAsk: () => true, setAsk };

		// Ticked + confirmed → persisted.
		await manager.open( openConfig( 'a' ) );
		confirmMock.mockImplementation( async ( options ) => {
			options.onRemember?.( true );
			return true;
		} );
		await closeAllWindows( manager, prefs );
		expect( setAsk ).toHaveBeenCalledWith( false );

		// Confirmed with the box left alone → nothing persisted.
		setAsk.mockClear();
		await manager.open( openConfig( 'b' ) );
		confirmMock.mockImplementation( async ( options ) => {
			options.onRemember?.( false );
			return true;
		} );
		await closeAllWindows( manager, prefs );
		expect( setAsk ).not.toHaveBeenCalled();
	} );

	test( 'with asking turned off it closes without a dialog', async () => {
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );

		const closed = await closeAllWindows( manager, {
			shouldAsk: () => false,
			setAsk: () => undefined,
		} );

		expect( closed ).toBe( 2 );
		expect( confirmMock ).not.toHaveBeenCalled();
		expect( manager.getAll() ).toHaveLength( 0 );
	} );

	test( 'the keypress and the bridge message both close', async () => {
		installCloseAllShortcut( manager );

		await manager.open( openConfig( 'a' ) );
		const e = chord();
		document.dispatchEvent( e );
		expect( e.defaultPrevented ).toBe( true );
		await vi.waitFor( () => expect( manager.getAll() ).toHaveLength( 0 ) );

		await manager.open( openConfig( 'b' ) );
		window.dispatchEvent(
			new MessageEvent( 'message', {
				data: { type: CLOSE_ALL_MESSAGE },
				origin: window.location.origin,
			} ),
		);
		await vi.waitFor( () => expect( manager.getAll() ).toHaveLength( 0 ) );
	} );
} );
