/**
 * Unit tests for the "View revisions" ⋯ menu row (`src/revisions/`):
 *
 *   - row registration through the public window-action registry, and
 *     `isVisible` / `label` following the identity's `revisionsUrl` /
 *     `revisionCount`
 *   - the pick: window id is a per-post singleton, the config carries
 *     the seeded `revisions` identity rooted at the post (so the tie
 *     draws before the iframe loads), the opened hook + CustomEvent
 *     fire, a missing URL toasts instead of opening
 *   - the `os.revisions.window-config` filter, including an invalid
 *     return falling back to the default
 *   - opening geometry: computed beside the editor on a first open,
 *     left alone once the window has remembered geometry
 *   - `revisionWindowPlacement` — right, left, and the diagonal corner
 *     fallback, plus clamping
 *   - the engine's handling of the two new identity keys: same-origin
 *     only, count only alongside a URL, and a revisions-only change
 *     still firing `content-changed` (the first save of a draft
 *     changes nothing else)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import { revisionWindowPlacement } from '../../src/revisions/placement';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const showToastSpy = vi.fn();
vi.mock( '../../src/toast', () => ( {
	showToast: ( ...args: unknown[] ) => showToastSpy( ...args ),
} ) );

const REVISIONS_URL = 'http://localhost:3000/wp-admin/revision.php?revision=9';

async function load() {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const mod = await import( '../../src/revisions' );
	const engine = await import( '../../src/window-links/engine' );
	const registry = await import( '../../src/window-actions/registry' );
	return { ...mod, ...engine, ...registry };
}

interface FakeWin {
	id: string;
	element: HTMLElement;
}

/**
 * A window fake positioned inside a fake `#os-area`, so the placement
 * math has real `offsetLeft` / `offsetWidth` numbers to read. jsdom
 * reports 0 for every offset metric, so they are defined outright.
 */
function fakeWin(
	id: string,
	box: { x: number; y: number; width: number; height: number } | null = null,
): FakeWin {
	const element = document.createElement( 'div' );
	document.body.appendChild( element );
	if ( box ) {
		Object.defineProperties( element, {
			offsetParent: { value: document.body, configurable: true },
			offsetLeft: { value: box.x, configurable: true },
			offsetTop: { value: box.y, configurable: true },
			offsetWidth: { value: box.width, configurable: true },
			offsetHeight: { value: box.height, configurable: true },
		} );
	}
	return { id, element };
}

/** A desktop area of the given size, as `openingGeometry()` reads it. */
function fakeArea( width: number, height: number ): HTMLElement {
	const area = document.createElement( 'div' );
	area.id = 'os-area';
	Object.defineProperties( area, {
		clientWidth: { value: width, configurable: true },
		clientHeight: { value: height, configurable: true },
	} );
	document.body.appendChild( area );
	return area;
}

/** A manager fake: `open()` records the config and returns a window. */
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
		getById( id: string ) {
			return windows.get( id ) ?? null;
		},
	};
}

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
	showToastSpy.mockClear();
	window.localStorage.clear();
	// Desktop width by default — the small-screen branch skips the
	// placement entirely.
	vi.stubGlobal(
		'matchMedia',
		vi.fn( ( query: string ) => ( {
			matches: false,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		} ) ),
	);
} );
afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	window.localStorage.clear();
	document.body.innerHTML = '';
} );

/** Boot the module against a fresh fake manager and hand back its row. */
async function boot() {
	const api = await load();
	const manager = fakeManager();
	api.bootRevisions( { manager } );
	const def = api
		.listWindowActions()
		.find( ( d ) => d.id === 'desktop-mode/view-revisions' )!;
	return { ...api, manager, def };
}

describe( 'bootRevisions', () => {
	test( 'registers the row on the public window-action registry', async () => {
		const { def } = await boot();

		expect( def ).toBeDefined();
		expect( def.icon ).toBe( 'dashicons-backup' );
		expect( def.order ).toBe( 60 );
		expect( def.checkable ).toBeUndefined();
	} );

	test( 'isVisible follows the identity revisionsUrl', async () => {
		const { def, setWindowContent } = await boot();
		const win = fakeWin( 'w1' );

		expect( def.isVisible!( win as never ) ).toBe( false );

		setWindowContent( 'w1', { type: 'post', id: 1 } );
		expect( def.isVisible!( win as never ) ).toBe( false );

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: REVISIONS_URL,
		} );
		expect( def.isVisible!( win as never ) ).toBe( true );
	} );

	test( 'the label carries the revision count when the server sent one', async () => {
		const { def, setWindowContent, resolveActionLabel } = await boot();
		const win = fakeWin( 'w1' );

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: REVISIONS_URL,
		} );
		expect( resolveActionLabel( def, win as never ) ).toBe(
			'View revisions',
		);

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: REVISIONS_URL,
			revisionCount: 4,
		} );
		expect( resolveActionLabel( def, win as never ) ).toBe(
			'View revisions (4)',
		);
	} );
} );

describe( 'openRevisionsWindow', () => {
	test( 'opens a per-post singleton seeded with the rooted identity', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			label: 'Hello world',
			revisionsUrl: REVISIONS_URL,
			revisionCount: 2,
		} );

		await openRevisionsWindow( manager, win );

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config.id ).toBe( 'revisions-post-7' );
		expect( config.baseId ).toBe( 'revisions-post-7' );
		expect( config.url ).toBe( REVISIONS_URL );
		expect( config.title ).toBe( 'Revisions: Hello world' );
		expect( config.icon ).toBe( 'dashicons-backup' );
		// Seeded identity: a child of the post, so the spline to the
		// editor draws without waiting on the iframe.
		expect( config.content ).toMatchObject( {
			type: 'revisions',
			id: 7,
			root: { type: 'post', id: 7 },
		} );
		// Restorable with the session — the URL carries no nonce.
		expect( config.ephemeral ).toBeUndefined();
	} );

	test( 'a CPT identity collapses its slash into the window id', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'acme/order',
			id: 12,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		expect( manager.open.mock.calls[ 0 ][ 0 ].id ).toBe(
			'revisions-acme-order-12',
		);
	} );

	test( 'fires the opened action and CustomEvent', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		const log = recordActions( hooks, [ HOOKS.REVISIONS_OPENED ] );
		const events: CustomEvent[] = [];
		document.addEventListener( 'os-revisions-opened', ( e ) => {
			events.push( e as CustomEvent );
		} );
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			editorWindowId: 'w1',
			revisionsWindowId: 'revisions-post-7',
		} );
		expect( events ).toHaveLength( 1 );
		expect( events[ 0 ].detail.revisionsWindowId ).toBe(
			'revisions-post-7',
		);
	} );

	test( 'toasts instead of opening when the identity lost its URL', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', { type: 'post', id: 7 } );

		await openRevisionsWindow( manager, win );

		expect( manager.open ).not.toHaveBeenCalled();
		expect( showToastSpy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the window-config filter can reshape the window', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		hooks.addFilter(
			HOOKS.REVISIONS_WINDOW_CONFIG,
			'test/reshape',
			( config ) => ( {
				...( config as Record< string, unknown > ),
				title: 'History',
				width: 500,
			} ),
		);
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config.title ).toBe( 'History' );
		expect( config.width ).toBe( 500 );
	} );

	test( 'an invalid filter return falls back to the default config', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		const warn = vi
			.spyOn( console, 'warn' )
			.mockImplementation( () => undefined );
		hooks.addFilter(
			HOOKS.REVISIONS_WINDOW_CONFIG,
			'test/broken',
			() => ( { id: '', url: '' } ),
		);
		const win = fakeWin( 'w1' );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		expect( manager.open.mock.calls[ 0 ][ 0 ].id ).toBe(
			'revisions-post-7',
		);
		expect( warn ).toHaveBeenCalled();
	} );
} );

describe( 'opening geometry', () => {
	test( 'places the window beside a measurable editor on a first open', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		fakeArea( 1600, 1000 );
		const win = fakeWin( 'w1', { x: 40, y: 60, width: 700, height: 800 } );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		const config = manager.open.mock.calls[ 0 ][ 0 ];
		// Right of the editor (40 + 700 + 16), top-aligned with it.
		expect( config.x ).toBe( 756 );
		expect( config.y ).toBe( 60 );
		expect( config.width ).toBeGreaterThan( 0 );
		expect( config.height ).toBeGreaterThan( 0 );
	} );

	test( 'leaves geometry to the manager once the window has remembered some', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		fakeArea( 1600, 1000 );
		const win = fakeWin( 'w1', { x: 40, y: 60, width: 700, height: 800 } );
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );
		const geometry = await import(
			'../../src/window-manager/native-window-geometry'
		);
		geometry.saveNativeWindowGeometry( 'revisions-post-7', {
			width: 400,
			height: 300,
		} );

		await openRevisionsWindow( manager, win );

		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config.x ).toBeUndefined();
		expect( config.y ).toBeUndefined();
		expect( config.width ).toBeUndefined();
		expect( config.height ).toBeUndefined();
	} );

	test( 'leaves geometry alone when the editor cannot be measured', async () => {
		const { manager, openRevisionsWindow, setWindowContent } =
			await boot();
		fakeArea( 1600, 1000 );
		const win = fakeWin( 'w1' ); // No offset metrics defined.
		manager.add( win );
		setWindowContent( 'w1', {
			type: 'post',
			id: 7,
			revisionsUrl: REVISIONS_URL,
		} );

		await openRevisionsWindow( manager, win );

		expect( manager.open.mock.calls[ 0 ][ 0 ].x ).toBeUndefined();
	} );
} );

describe( 'revisionWindowPlacement', () => {
	const desktop = { width: 1600, height: 1000 };

	test( 'prefers the space to the right of the editor', () => {
		const rect = revisionWindowPlacement(
			{ x: 40, y: 60, width: 700, height: 800 },
			desktop,
		);

		expect( rect.x ).toBe( 756 );
		expect( rect.y ).toBe( 60 );
		expect( rect.x + rect.width ).toBeLessThanOrEqual( desktop.width );
	} );

	test( 'falls back to the space on the left', () => {
		const rect = revisionWindowPlacement(
			{ x: 820, y: 40, width: 740, height: 800 },
			desktop,
		);

		expect( rect.x + rect.width ).toBeLessThanOrEqual( 820 );
		expect( rect.x ).toBeGreaterThanOrEqual( 16 );
	} );

	test( 'takes the opposite corner when neither side fits', () => {
		// A near-full-width editor leaning top-left leaves no gap on
		// either side, so the window goes bottom-right.
		const rect = revisionWindowPlacement(
			{ x: 20, y: 20, width: 1500, height: 500 },
			desktop,
		);

		expect( rect.x + rect.width ).toBe( desktop.width - 16 );
		expect( rect.y + rect.height ).toBe( desktop.height - 16 );
	} );

	test( 'never opens below the desktop when the editor sits low', () => {
		const rect = revisionWindowPlacement(
			{ x: 40, y: 900, width: 600, height: 80 },
			desktop,
		);

		expect( rect.y ).toBeGreaterThanOrEqual( 16 );
		expect( rect.y + rect.height ).toBeLessThanOrEqual( desktop.height );
	} );

	test( 'a maximized editor pushes the window to the bottom right', () => {
		const rect = revisionWindowPlacement(
			{ x: 0, y: 0, width: desktop.width, height: desktop.height },
			desktop,
		);

		expect( rect.x + rect.width ).toBe( desktop.width - 16 );
		expect( rect.y + rect.height ).toBe( desktop.height - 16 );
	} );

	test( 'stays usable on a small desktop', () => {
		const rect = revisionWindowPlacement(
			{ x: 0, y: 0, width: 300, height: 300 },
			{ width: 360, height: 300 },
		);

		expect( rect.width ).toBeGreaterThanOrEqual( 320 );
		expect( rect.height ).toBeGreaterThanOrEqual( 200 );
	} );
} );

describe( 'identity handling in the relations engine', () => {
	test( 'drops a cross-origin revisionsUrl', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: 'https://evil.example/wp-admin/revision.php',
			revisionCount: 3,
		} );

		expect( getWindowContent( 'w1' )?.revisionsUrl ).toBeUndefined();
		expect( getWindowContent( 'w1' )?.revisionCount ).toBeUndefined();
	} );

	test( 'keeps the count only alongside a surviving URL', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', { type: 'post', id: 1, revisionCount: 3 } );
		expect( getWindowContent( 'w1' )?.revisionCount ).toBeUndefined();

		setWindowContent( 'w2', {
			type: 'post',
			id: 2,
			revisionsUrl: REVISIONS_URL,
			revisionCount: 3.7,
		} );
		expect( getWindowContent( 'w2' )?.revisionCount ).toBe( 3 );
	} );

	test( 'a revisions-only change still reports content-changed', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );

		// A draft with nothing else on its identity — exactly the
		// shape the first save changes.
		setWindowContent( 'w1', { type: 'post', id: 1, label: 'Draft' } );
		expect( log ).toHaveLength( 1 );

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			label: 'Draft',
			revisionsUrl: REVISIONS_URL,
			revisionCount: 1,
		} );
		expect( log ).toHaveLength( 2 );

		// …and a genuinely identical re-announce still no-ops.
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			label: 'Draft',
			revisionsUrl: REVISIONS_URL,
			revisionCount: 1,
		} );
		expect( log ).toHaveLength( 2 );
	} );

	test( 'a changed count alone reports content-changed', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: REVISIONS_URL,
			revisionCount: 1,
		} );
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			revisionsUrl: REVISIONS_URL,
			revisionCount: 2,
		} );

		expect( log ).toHaveLength( 2 );
	} );
} );
