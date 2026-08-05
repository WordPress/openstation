/**
 * Unit tests for the editor-preview ("eye") title-bar button
 * (`src/editor-preview/`):
 *
 *   - button registration through the public title-bar registry and
 *     the `match` predicate following the identity's `previewUrl`
 *   - click flow: snap-left, autosave transport, companion window
 *     opened snapped-right + ephemeral, singleton id per post,
 *     fresh-autosave previewUrl preferred over the identity's
 *   - the `os.editor-preview.window-config` filter
 *   - toggle-off on second click
 *   - lifecycle: editor close destroys the companion, preview close
 *     only clears the pairing, content change to a different post
 *     closes the companion
 *   - save-driven reload: matching broadcast reloads (debounced),
 *     changed previewUrl navigates instead
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const mod = await import( '../../src/editor-preview' );
	const engine = await import( '../../src/window-links/engine' );
	const registry = await import( '../../src/title-bar-buttons/registry' );
	const broadcastMod = await import( '../../src/broadcast' );
	return { ...mod, ...engine, ...registry, ...broadcastMod };
}

interface FakeWin {
	id: string;
	config: { native?: boolean; ephemeral?: boolean };
	iframe: HTMLIFrameElement | null;
	getCurrentUrl?: () => string;
	applySnap: ReturnType< typeof vi.fn >;
	renderCustomTitleBarButtons: ReturnType< typeof vi.fn >;
	reload: ReturnType< typeof vi.fn >;
	swapReload?: ReturnType< typeof vi.fn >;
	navigateTo: ReturnType< typeof vi.fn >;
	close: ReturnType< typeof vi.fn >;
	destroy: ReturnType< typeof vi.fn >;
}

function fakeWin( id: string ): FakeWin {
	return {
		id,
		config: {},
		iframe: null,
		applySnap: vi.fn(),
		renderCustomTitleBarButtons: vi.fn(),
		reload: vi.fn(),
		swapReload: vi.fn(),
		navigateTo: vi.fn( () => true ),
		close: vi.fn(),
		destroy: vi.fn(),
	};
}

/** A capture-only stand-in for the editor window's iframe. */
function fakeIframe() {
	const postMessage = vi.fn();
	return {
		postMessage,
		iframe: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement,
	};
}

/**
 * A manager fake: `open()` records the config, creates a fake window
 * under the config id, and returns it.
 */
function fakeManager() {
	const windows = new Map< string, FakeWin >();
	const open = vi.fn(
		async ( config: { id: string } & Record< string, unknown > ) => {
			const win = fakeWin( config.id );
			windows.set( config.id, win );
			return win;
		},
	);
	return {
		windows,
		open,
		add( win: FakeWin ) {
			windows.set( win.id, win );
		},
		remove( id: string ) {
			windows.delete( id );
		},
		getById( id: string ) {
			return windows.get( id ) ?? null;
		},
	};
}

const PREVIEW_URL = '/?p=1&preview=true&preview_nonce=aaa';

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
} );
afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.body.innerHTML = '';
} );

/**
 * Boot the module against a fresh fake manager + stubbed transport.
 * The default transport answers `not-dirty` — nothing saved, so the
 * click flow schedules no post-open refresh and lifecycle tests stay
 * free of stray debounce timers. Tests exercising the refresh pass
 * an explicit `saved` result.
 */
async function boot(
	transportResult: import( '../../src/editor-preview/autosave' ).AutosaveResult = {
		status: 'not-dirty',
	},
) {
	const api = await load();
	const manager = fakeManager();
	const transport = vi.fn( async () => transportResult );
	api._setAutosaveTransportForTests( transport );
	api.bootEditorPreview( { manager } );
	const def = api
		.listTitleBarButtons()
		.find( ( d ) => d.id === 'desktop-mode/editor-preview' )!;
	return { ...api, manager, transport, def };
}

/** Render the eye onto a host and click it, awaiting the async flow. */
async function clickEye(
	def: {
		render?: ( host: HTMLElement, win: never ) => void;
	},
	win: FakeWin,
) {
	const host = document.createElement( 'os-window-button' );
	document.body.appendChild( host );
	def.render!( host, win as never );
	host.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
	// The click handler awaits the autosave transport + manager.open —
	// flush the microtask chain.
	for ( let i = 0; i < 6; i++ ) {
		await Promise.resolve();
	}
	return host;
}

describe( 'bootEditorPreview', () => {
	test( 'registers the eye on the public title-bar registry', async () => {
		const { def } = await boot();

		expect( def ).toBeDefined();
		expect( def.placement ).toBe( 'right' );
		expect( def.icon ).toBe( 'dashicons-visibility' );
		expect( def.order ).toBe( 55 );
	} );

	test( 'match follows the identity previewUrl', async () => {
		const { def, setWindowContent } = await boot();
		const win = fakeWin( 'w1' );

		expect( def.match( win as never ) ).toBe( false );

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		expect( def.match( win as never ) ).toBe( true );

		// No previewUrl (list table, non-viewable type) — no eye.
		setWindowContent( 'w1', { type: 'post', id: 1 } );
		expect( def.match( win as never ) ).toBe( false );
	} );

	test( 'never matches native windows', async () => {
		const { def, setWindowContent } = await boot();
		const win = fakeWin( 'w1' );
		win.config.native = true;

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		expect( def.match( win as never ) ).toBe( false );
	} );

	test( 'matches the unsaved "Add New" screen via its URL', async () => {
		const { def } = await boot();
		const win = fakeWin( 'w1' );
		win.getCurrentUrl = () => '/wp-admin/post-new.php';

		expect( def.match( win as never ) ).toBe( true );

		win.getCurrentUrl = () => '/wp-admin/edit.php';
		expect( def.match( win as never ) ).toBe( false );
	} );

	test( 'renders DISABLED on the unsaved screen — click never opens', async () => {
		const { def, manager, transport } = await boot();
		const editor = fakeWin( 'w1' );
		editor.getCurrentUrl = () => '/wp-admin/post-new.php';
		manager.add( editor );

		const host = await clickEye( def, editor );

		expect( host.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect(
			host.classList.contains( 'os-window__btn--disabled' ),
		).toBe( true );
		expect( transport ).not.toHaveBeenCalled();
		expect( manager.open ).not.toHaveBeenCalled();
		expect( editor.applySnap ).not.toHaveBeenCalled();
	} );

	test( 'IFRAME_READY repaints that window (post-new needs no identity change)', async () => {
		const { manager } = await boot();
		const editor = fakeWin( 'w1' );
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: 'w1' } );

		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'eye click', () => {
	test( 'snaps the editor left and opens the companion snapped right', async () => {
		const { def, manager, transport, setWindowContent } = await boot();
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( def, editor );

		expect( editor.applySnap ).toHaveBeenCalledWith( 'left' );
		expect( transport ).toHaveBeenCalledTimes( 1 );
		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config.id ).toBe( 'editor-preview-post-1' );
		expect( config.baseId ).toBe( 'editor-preview-post-1' );
		expect( config.url ).toBe( PREVIEW_URL );
		expect( config.initialState ).toBe( 'snapped-right' );
		expect( config.ephemeral ).toBe( true );
	} );

	test( 'a saved autosave silently refreshes the companion at the fresh link', async () => {
		const fresh = '/?p=1&preview=true&preview_nonce=fresh';
		const { def, manager, setWindowContent } = await boot( {
			status: 'saved',
			previewUrl: fresh,
		} );
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		vi.useFakeTimers();
		await clickEye( def, editor );

		// The companion opens immediately at the identity link — it
		// never waits for the autosave round-trip…
		expect( manager.open.mock.calls[ 0 ][ 0 ].url ).toBe( PREVIEW_URL );

		// …and the landed save refreshes it at the fresher one,
		// debounced and silent.
		const preview = manager.getById( 'editor-preview-post-1' )!;
		expect( preview.swapReload ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( 500 );
		expect( preview.swapReload ).toHaveBeenCalledWith( fresh );
	} );

	test( 'a timeout leaves the companion on the identity previewUrl', async () => {
		const { def, manager, setWindowContent } = await boot( {
			status: 'timeout',
		} );
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		vi.useFakeTimers();
		await clickEye( def, editor );

		expect( manager.open.mock.calls[ 0 ][ 0 ].url ).toBe( PREVIEW_URL );

		// Nothing was saved — no refresh gets scheduled.
		const preview = manager.getById( 'editor-preview-post-1' )!;
		vi.advanceTimersByTime( 5000 );
		expect( preview.swapReload ).not.toHaveBeenCalled();
	} );

	test( 'the companion opens before the autosave settles', async () => {
		const api = await boot();
		let release: (
			r: import( '../../src/editor-preview/autosave' ).AutosaveResult,
		) => void = () => undefined;
		api._setAutosaveTransportForTests(
			() =>
				new Promise( ( resolve ) => {
					release = resolve;
				} ),
		);
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( api.def, editor );

		// The save round-trip is still in flight — the companion is
		// already open and the pairing recorded (a slow save used to
		// read as a hang: nothing on screen reacted until it landed).
		expect( api.manager.open ).toHaveBeenCalledTimes( 1 );
		expect( api.manager.getById( 'editor-preview-post-1' ) ).toBeTruthy();

		// The eye pulses while the save settles…
		const host = document.createElement( 'os-window-button' );
		api.def.render!( host, editor as never );
		expect( host.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( host.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		// …and stops once it lands.
		release( { status: 'saved' } );
		for ( let i = 0; i < 6; i++ ) {
			await Promise.resolve();
		}
		const settled = document.createElement( 'os-window-button' );
		api.def.render!( settled, editor as never );
		expect( settled.getAttribute( 'aria-busy' ) ).toBeNull();
	} );

	test( 'fires EDITOR_PREVIEW_OPENED with the pairing payload', async () => {
		const { def, manager, setWindowContent } = await boot();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_OPENED ] );
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( def, editor );

		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			editorWindowId: 'w1',
			previewWindowId: 'editor-preview-post-1',
		} );
	} );

	test( 'the window-config filter can reshape the companion', async () => {
		const { def, manager, setWindowContent } = await boot();
		hooks.addFilter(
			HOOKS.EDITOR_PREVIEW_WINDOW_CONFIG,
			'vitest/reshape',
			( config ) => ( {
				...( config as Record< string, unknown > ),
				initialState: 'normal',
				width: 400,
			} ),
		);
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( def, editor );

		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config.initialState ).toBe( 'normal' );
		expect( config.width ).toBe( 400 );
	} );

	test( 'an invalid window-config filter return is ignored', async () => {
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const { def, manager, setWindowContent } = await boot();
		hooks.addFilter(
			HOOKS.EDITOR_PREVIEW_WINDOW_CONFIG,
			'vitest/broken',
			() => null,
		);
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( def, editor );

		expect( manager.open.mock.calls[ 0 ][ 0 ].id ).toBe(
			'editor-preview-post-1',
		);
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'second click toggles the companion closed', async () => {
		const { def, manager, setWindowContent } = await boot();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_CLOSED ] );
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( def, editor );
		const preview = manager.getById( 'editor-preview-post-1' )!;

		await clickEye( def, editor );

		expect( preview.close ).toHaveBeenCalledTimes( 1 );
		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( { reason: 'toggled' } );
	} );

	test( 'destroys the companion when the editor closed while open() was in flight', async () => {
		const { def, manager, setWindowContent } = await boot();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_OPENED ] );
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		// Hold manager.open() open so the editor can close mid-flight.
		let release: () => void = () => undefined;
		const gate = new Promise< void >( ( resolve ) => {
			release = resolve;
		} );
		manager.open.mockImplementation(
			async ( config: { id: string } & Record< string, unknown > ) => {
				const win = fakeWin( config.id );
				manager.windows.set( config.id, win );
				await gate;
				return win;
			},
		);

		const host = document.createElement( 'os-window-button' );
		document.body.appendChild( host );
		def.render!( host, editor as never );
		host.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		// Let the flow reach manager.open().
		for ( let i = 0; i < 6; i++ ) {
			await Promise.resolve();
		}
		expect( manager.open ).toHaveBeenCalledTimes( 1 );

		// The editor closes while the companion is still opening.
		manager.remove( 'w1' );
		release();
		for ( let i = 0; i < 6; i++ ) {
			await Promise.resolve();
		}

		// The orphaned companion is destroyed, no pairing recorded.
		const preview = manager.getById( 'editor-preview-post-1' )!;
		expect( preview.destroy ).toHaveBeenCalledTimes( 1 );
		expect( log ).toHaveLength( 0 );
	} );

	test( 'does not open when the editor window is already gone', async () => {
		const { def, manager, transport, setWindowContent } = await boot();
		const editor = fakeWin( 'w1' );
		manager.add( editor );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		const host = document.createElement( 'os-window-button' );
		def.render!( host, editor as never );
		// The editor vanished between render and click (stale button).
		manager.remove( 'w1' );
		host.dispatchEvent( new MouseEvent( 'click' ) );
		for ( let i = 0; i < 6; i++ ) {
			await Promise.resolve();
		}

		expect( manager.open ).not.toHaveBeenCalled();
		expect( transport ).not.toHaveBeenCalled();
	} );

	test( 'a save landing after teardown schedules no reload', async () => {
		const api = await boot();
		let release: (
			r: import( '../../src/editor-preview/autosave' ).AutosaveResult,
		) => void = () => undefined;
		api._setAutosaveTransportForTests(
			() =>
				new Promise( ( resolve ) => {
					release = resolve;
				} ),
		);
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );

		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		// The editor closes while the save is still on the wire — the
		// normal lifecycle takes the companion down with it.
		api.manager.remove( 'w1' );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'w1' } );
		expect( preview.destroy ).toHaveBeenCalledTimes( 1 );

		// The late save must not resurrect a reload on the dead pairing.
		vi.useFakeTimers();
		release( { status: 'saved' } );
		for ( let i = 0; i < 6; i++ ) {
			await Promise.resolve();
		}
		vi.advanceTimersByTime( 5000 );
		expect( preview.swapReload ).not.toHaveBeenCalled();
	} );
} );

describe( 'pairing lifecycle', () => {
	async function openPairing() {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;
		return { ...api, editor, preview };
	}

	test( 'editor close destroys the companion', async () => {
		const { manager, editor, preview } = await openPairing();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_CLOSED ] );

		manager.remove( editor.id );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'w1' } );

		expect( preview.destroy ).toHaveBeenCalledTimes( 1 );
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			reason: 'editor-closed',
		} );
	} );

	test( 'preview close only clears the pairing — editor untouched', async () => {
		const { manager, editor, preview } = await openPairing();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_CLOSED ] );

		manager.remove( preview.id );
		hooks.doAction( HOOKS.WINDOW_CLOSED, {
			windowId: 'editor-preview-post-1',
		} );

		expect( editor.close ).not.toHaveBeenCalled();
		expect( editor.destroy ).not.toHaveBeenCalled();
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			reason: 'preview-closed',
		} );
		// The eye un-presses via a repaint of the editor's buttons.
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalled();
	} );

	test( 'navigating the editor to a different post closes the companion', async () => {
		const { setWindowContent, preview } = await openPairing();
		const log = recordActions( hooks, [ HOOKS.EDITOR_PREVIEW_CLOSED ] );

		setWindowContent( 'w1', {
			type: 'post',
			id: 2,
			previewUrl: '/?p=2&preview=true',
		} );

		expect( preview.close ).toHaveBeenCalledTimes( 1 );
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			reason: 'content-changed',
		} );
	} );

	test( 'a same-post identity refresh keeps the pairing', async () => {
		const { setWindowContent, preview } = await openPairing();

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: '/?p=1&preview=true&preview_nonce=bbb',
		} );

		expect( preview.close ).not.toHaveBeenCalled();
		expect( preview.destroy ).not.toHaveBeenCalled();
	} );
} );

describe( 'save-driven reload', () => {
	test( 'a matching broadcast refreshes the companion, debounced', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		vi.useFakeTimers();
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 1 ],
		} );
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 1 ],
		} );

		expect( preview.swapReload ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( 500 );
		// The silent double-buffered swap — never the overlay reload.
		expect( preview.swapReload ).toHaveBeenCalledTimes( 1 );
		expect( preview.swapReload ).toHaveBeenCalledWith( undefined );
		expect( preview.reload ).not.toHaveBeenCalled();
	} );

	test( 'falls back to the classic reload when swapReload is unavailable', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;
		delete preview.swapReload;

		vi.useFakeTimers();
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 1 ],
		} );
		vi.advanceTimersByTime( 500 );

		expect( preview.reload ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a broadcast for a different post is ignored', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		vi.useFakeTimers();
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 99 ],
		} );
		vi.advanceTimersByTime( 500 );

		expect( preview.swapReload ).not.toHaveBeenCalled();
		expect( preview.reload ).not.toHaveBeenCalled();
	} );

	test( 'passes the fresh URL to the swap when the previewUrl changed', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		// The save-watcher refetched the identity — new permalink.
		const published = '/hello-world/?preview_nonce=ccc&preview=true';
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: published,
		} );

		vi.useFakeTimers();
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 1 ],
		} );
		vi.advanceTimersByTime( 500 );

		expect( preview.swapReload ).toHaveBeenCalledWith( published );
	} );

	test( 'a live-saved nudge from the watched editor reloads the companion', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		const frame = fakeIframe();
		editor.iframe = frame.iframe;
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		// The pairing asked the editor iframe to start a live watch.
		const watchMsg = frame.postMessage.mock.calls
			.map( ( c ) => c[ 0 ] as { type?: string; watchId?: string; debounceMs?: number } )
			.find( ( m ) => m.type === 'os-editor-live-watch' );
		expect( watchMsg ).toBeDefined();
		expect( watchMsg!.debounceMs ).toBe( 1500 );

		vi.useFakeTimers();
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-editor-live-saved',
					watchId: watchMsg!.watchId,
				},
			} ),
		);
		expect( preview.swapReload ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( 500 );
		expect( preview.swapReload ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'teardown unwatches the editor iframe', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		const frame = fakeIframe();
		editor.iframe = frame.iframe;
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );

		await clickEye( api.def, editor ); // Toggle off.

		const types = frame.postMessage.mock.calls.map(
			( c ) => ( c[ 0 ] as { type?: string } ).type,
		);
		expect( types ).toContain( 'os-editor-live-unwatch' );
	} );

	test( 'IFRAME_READY re-arms the live watch with a fresh id', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		const frame = fakeIframe();
		editor.iframe = frame.iframe;
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );

		const watchMsgs = () =>
			frame.postMessage.mock.calls
				.map( ( c ) => c[ 0 ] as { type?: string; watchId?: string } )
				.filter( ( m ) => m.type === 'os-editor-live-watch' );
		expect( watchMsgs() ).toHaveLength( 1 );
		const firstId = watchMsgs()[ 0 ].watchId;

		// The editor page reloaded (the classic editor does on every
		// manual save) — readiness re-announces, and the watch, which
		// died with the old page, must be re-armed under a fresh id.
		hooks.doAction( HOOKS.IFRAME_READY, { windowId: 'w1' } );

		expect( watchMsgs() ).toHaveLength( 2 );
		const secondId = watchMsgs()[ 1 ].watchId;
		expect( secondId ).not.toBe( firstId );

		// The previous id was unwatched first, so a page that never
		// reloaded doesn't end up autosaving twice per pause.
		const unwatch = frame.postMessage.mock.calls
			.map( ( c ) => c[ 0 ] as { type?: string; watchId?: string } )
			.find( ( m ) => m.type === 'os-editor-live-unwatch' );
		expect( unwatch?.watchId ).toBe( firstId );

		// A live-saved under the new id still reloads the companion.
		const preview = api.manager.getById( 'editor-preview-post-1' )!;
		vi.useFakeTimers();
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-editor-live-saved',
					watchId: secondId,
				},
			} ),
		);
		vi.advanceTimersByTime( 500 );
		expect( preview.swapReload ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the live filter can disable typing-driven updates', async () => {
		const api = await boot();
		hooks.addFilter(
			HOOKS.EDITOR_PREVIEW_LIVE,
			'vitest/off',
			() => ( { enabled: false } ),
		);
		const editor = fakeWin( 'w1' );
		const frame = fakeIframe();
		editor.iframe = frame.iframe;
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );

		const types = frame.postMessage.mock.calls.map(
			( c ) => ( c[ 0 ] as { type?: string } ).type,
		);
		expect( types ).not.toContain( 'os-editor-live-watch' );
	} );

	test( 'the subscription is torn down with the pairing', async () => {
		const api = await boot();
		const editor = fakeWin( 'w1' );
		api.manager.add( editor );
		api.setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			previewUrl: PREVIEW_URL,
		} );
		await clickEye( api.def, editor );
		const preview = api.manager.getById( 'editor-preview-post-1' )!;

		// Toggle off, then broadcast — nothing may reload.
		await clickEye( api.def, editor );
		vi.useFakeTimers();
		api.broadcast( 'os.post.changed', {
			source: 'editor',
			action: 'updated',
			ids: [ 1 ],
		} );
		vi.advanceTimersByTime( 500 );

		expect( preview.swapReload ).not.toHaveBeenCalled();
		expect( preview.reload ).not.toHaveBeenCalled();
	} );
} );
