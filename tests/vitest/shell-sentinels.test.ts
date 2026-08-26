/**
 * Runtime behavior of the shell-bundle-diet sentinels.
 *
 * The static boundary walk (`shell-bundle-boundary.test.ts`) proves
 * the heavy modules stay OUT of the shell; these tests prove the
 * small pieces left behind do their jobs — above all the file-drop
 * race: a drop landing while the bundle is still fetching must be
 * captured synchronously and replayed once the bundle boots, because
 * `DataTransfer` is unreadable after the event and a swallowed drop
 * reads as the desktop eating files.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as vendorLoader from '../../src/wallpapers/vendor-loader';
import * as toast from '../../src/toast';
import { installFileDropSentinel } from '../../src/os-file-drop/sentinel';
import { installNotesSentinel } from '../../src/notes/sentinel';
import { installDockConstellationSentinel } from '../../src/dock-constellation/sentinel';
import { NOTE_CREATED_EVENT } from '../../src/notes/types';
import { DRAG_EVENTS } from '../../src/drag/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { FakeWpHooks } from './helpers/hooks-stub';

/** A synthetic drag event carrying (or not carrying) OS files. */
function dragEvent(
	type: string,
	opts: { files?: File[]; types?: string[]; x?: number; y?: number } = {},
): Event {
	const ev = new Event( type, { bubbles: true, cancelable: true } );
	Object.defineProperty( ev, 'dataTransfer', {
		value: {
			types: opts.types ?? ( opts.files ? [ 'Files' ] : [] ),
			files: opts.files ?? [],
			dropEffect: '',
		},
	} );
	Object.defineProperty( ev, 'clientX', { value: opts.x ?? 10 } );
	Object.defineProperty( ev, 'clientY', { value: opts.y ?? 20 } );
	return ev;
}

type FileDropApi = NonNullable< Window[ 'openStationFileDrop' ] >;

describe( 'file-drop sentinel', () => {
	const teardowns: Array< () => void > = [];
	let resolveLoad: () => void;
	let rejectLoad: ( err: Error ) => void;
	let loadCalls: number;
	let api: { boot: ReturnType< typeof vi.fn >; replayCapturedDrop: ReturnType< typeof vi.fn >; routePickedFiles: ReturnType< typeof vi.fn > };

	beforeEach( () => {
		loadCalls = 0;
		api = {
			boot: vi.fn(),
			replayCapturedDrop: vi.fn(),
			routePickedFiles: vi.fn(),
		};
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			() =>
				new Promise< void >( ( resolve, reject ) => {
					loadCalls += 1;
					resolveLoad = () => {
						// The real bundle publishes its API as a load
						// side effect — mirror that here.
						window.openStationFileDrop = api as unknown as FileDropApi;
						resolve();
					};
					rejectLoad = reject;
				} ),
		);
		vi.spyOn( toast, 'showToast' ).mockImplementation( () => undefined );
	} );

	afterEach( () => {
		for ( const teardown of teardowns.splice( 0 ) ) {
			teardown();
		}
		vi.restoreAllMocks();
		delete window.openStationFileDrop;
	} );

	const BOOT_ARGS = { mediaUrl: 'https://x.test/media', restNonce: 'n' };

	test( 'a drop during the fetch is captured and replayed with its files', async () => {
		teardowns.push( installFileDropSentinel( {
			bundleUrl: 'https://x.test/file-drop.js',
			boot: BOOT_ARGS as Parameters< FileDropApi[ 'boot' ] >[ 0 ],
		} ) );

		const file = new File( [ 'x' ], 'photo.png', { type: 'image/png' } );
		window.dispatchEvent( dragEvent( 'dragenter', { files: [ file ] } ) );
		expect( loadCalls ).toBe( 1 );

		// The drop beats the fetch.
		const drop = dragEvent( 'drop', { files: [ file ], x: 33, y: 44 } );
		window.dispatchEvent( drop );
		expect( drop.defaultPrevented ).toBe( true );
		expect( api.replayCapturedDrop ).not.toHaveBeenCalled();

		resolveLoad();
		await Promise.resolve();
		await Promise.resolve();

		expect( api.boot ).toHaveBeenCalledWith( BOOT_ARGS );
		expect( api.replayCapturedDrop ).toHaveBeenCalledTimes( 1 );
		const captured = api.replayCapturedDrop.mock.calls[ 0 ][ 0 ];
		expect( captured.files ).toEqual( [ file ] );
		expect( captured.clientX ).toBe( 33 );
		expect( captured.clientY ).toBe( 44 );
	} );

	test( 'repeat dragenters share one load (single flight)', () => {
		teardowns.push( installFileDropSentinel( {
			bundleUrl: 'https://x.test/file-drop.js',
			boot: BOOT_ARGS as Parameters< FileDropApi[ 'boot' ] >[ 0 ],
		} ) );
		const file = new File( [ 'x' ], 'a.txt' );
		window.dispatchEvent( dragEvent( 'dragenter', { files: [ file ] } ) );
		window.dispatchEvent( dragEvent( 'dragenter', { files: [ file ] } ) );
		expect( loadCalls ).toBe( 1 );
	} );

	test( 'internal drags (no Files type) never trigger the load', () => {
		teardowns.push( installFileDropSentinel( {
			bundleUrl: 'https://x.test/file-drop.js',
			boot: BOOT_ARGS as Parameters< FileDropApi[ 'boot' ] >[ 0 ],
		} ) );
		window.dispatchEvent(
			dragEvent( 'dragenter', { types: [ 'application/x-os-tile' ] } ),
		);
		expect( loadCalls ).toBe( 0 );
	} );

	test( 'a terminal failure with a captured drop tells the user and allows a retry', async () => {
		teardowns.push( installFileDropSentinel( {
			bundleUrl: 'https://x.test/file-drop.js',
			boot: BOOT_ARGS as Parameters< FileDropApi[ 'boot' ] >[ 0 ],
		} ) );
		const file = new File( [ 'x' ], 'a.txt' );
		window.dispatchEvent( dragEvent( 'dragenter', { files: [ file ] } ) );
		window.dispatchEvent( dragEvent( 'drop', { files: [ file ] } ) );

		vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
		rejectLoad( new Error( 'offline' ) );
		await Promise.resolve();
		await Promise.resolve();

		// User data in limbo must not vanish silently.
		expect( toast.showToast ).toHaveBeenCalled();
		// …and the next gesture retries the fetch.
		window.dispatchEvent( dragEvent( 'dragenter', { files: [ file ] } ) );
		expect( loadCalls ).toBe( 2 );
	} );
} );

type NotesApi = NonNullable< Window[ 'openStationNotes' ] >;

describe( 'notes sentinel', () => {
	const teardowns: Array< () => void > = [];
	let hooks: FakeWpHooks;
	let loadCalls: number;
	let resolveLoad: () => void;
	let boot: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		hooks = installHooksStub();
		loadCalls = 0;
		boot = vi.fn( () => null );
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					loadCalls += 1;
					resolveLoad = () => {
						window.openStationNotes = {
							boot,
						} as unknown as NotesApi;
						resolve();
					};
				} ),
		);
	} );

	afterEach( () => {
		for ( const teardown of teardowns.splice( 0 ) ) {
			teardown();
		}
		clearHooksStub();
		vi.restoreAllMocks();
		delete window.openStationNotes;
	} );

	const ARGS = {
		bundleUrl: 'https://x.test/notes.js',
		host: document.createElement( 'div' ),
		config: {} as never,
	};

	test( 'a note created before the bundle lands is stashed and re-announced', async () => {
		teardowns.push( installNotesSentinel( { ...ARGS, hasNotes: false } ) );

		const seen: unknown[] = [];
		document.addEventListener( NOTE_CREATED_EVENT, ( ev ) => {
			seen.push( ( ev as CustomEvent ).detail );
		} );
		document.dispatchEvent(
			new CustomEvent( NOTE_CREATED_EVENT, {
				detail: { note: { id: 7, updatedAtMs: 1 } },
			} ),
		);
		expect( loadCalls ).toBe( 1 );
		expect( boot ).not.toHaveBeenCalled();

		resolveLoad();
		await Promise.resolve();
		await Promise.resolve();

		expect( boot ).toHaveBeenCalledTimes( 1 );
		// Original dispatch + the sentinel's re-announcement, so the
		// layer's own listener (attached during boot) can pin it.
		expect( seen ).toHaveLength( 2 );
		expect( ( seen[ 1 ] as { note: { id: number } } ).note.id ).toBe( 7 );
	} );

	test( 'the wallpaper menu gets a "New note" item that yields to an existing one', () => {
		teardowns.push( installNotesSentinel( { ...ARGS, hasNotes: false } ) );

		const items = hooks.applyFilters(
			'os.wallpaper-context-menu',
			[],
			{ x: 1, y: 2 },
		) as Array< { id: string } >;
		expect( items.some( ( item ) => item.id === 'new-note' ) ).toBe( true );

		const already = [ { id: 'new-note', marker: 'the-real-one' } ];
		const merged = hooks.applyFilters(
			'os.wallpaper-context-menu',
			already,
			{ x: 1, y: 2 },
		) as Array< { id: string } >;
		expect( merged ).toEqual( already );
	} );

	test( 'hasNotes loads the bundle without any gesture', async () => {
		vi.useFakeTimers();
		teardowns.push( installNotesSentinel( { ...ARGS, hasNotes: true } ) );
		expect( loadCalls ).toBe( 0 );
		vi.advanceTimersByTime( 250 );
		expect( loadCalls ).toBe( 1 );
		vi.useRealTimers();
	} );

	test( 'a native dragstart loads the bundle (a file coming in from the OS)', () => {
		teardowns.push( installNotesSentinel( { ...ARGS, hasNotes: false } ) );
		window.dispatchEvent( new Event( 'dragstart' ) );
		expect( loadCalls ).toBe( 1 );
	} );

	test( 'an in-shell drag loads it too — those never fire dragstart', () => {
		// The Note Pad tear-off and every desktop tile are
		// pointer-driven through `DragManager`, which creates no native
		// drag and dispatches `os.drag.start` instead. A user with no
		// notes yet could tear a draft off the pad and have nothing
		// happen at all, because the drop handlers live in the bundle
		// this listener exists to fetch.
		teardowns.push( installNotesSentinel( { ...ARGS, hasNotes: false } ) );

		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.START ) );

		expect( loadCalls ).toBe( 1 );
	} );
} );

type ConstellationApi = NonNullable<
	Window[ 'openStationDockConstellation' ]
>;

describe( 'dock-constellation sentinel', () => {
	afterEach( () => {
		vi.restoreAllMocks();
		delete window.openStationDockConstellation;
		document.body.innerHTML = '';
	} );

	test( 'loads and mounts on the first pointer entering a dock rail — and only there', async () => {
		let resolveLoad!: () => void;
		const mount = vi.fn();
		let loadCalls = 0;
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					loadCalls += 1;
					resolveLoad = () => {
						window.openStationDockConstellation = {
							mount,
						} as unknown as ConstellationApi;
						resolve();
					};
				} ),
		);

		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		const tile = document.createElement( 'button' );
		dock.appendChild( tile );
		const elsewhere = document.createElement( 'div' );
		document.body.append( dock, elsewhere );

		const deps = { adminUrl: '/wp-admin/' } as Parameters<
			ConstellationApi[ 'mount' ]
		>[ 0 ];
		const teardown = installDockConstellationSentinel( {
			bundleUrl: 'https://x.test/dock-constellation.js',
			deps,
		} );

		elsewhere.dispatchEvent(
			new Event( 'pointerover', { bubbles: true } ),
		);
		expect( loadCalls ).toBe( 0 );

		tile.dispatchEvent( new Event( 'pointerover', { bubbles: true } ) );
		expect( loadCalls ).toBe( 1 );
		// Hovering again mid-fetch must not double-load.
		tile.dispatchEvent( new Event( 'pointerover', { bubbles: true } ) );
		expect( loadCalls ).toBe( 1 );

		resolveLoad();
		await Promise.resolve();
		await Promise.resolve();
		expect( mount ).toHaveBeenCalledWith( deps );
		teardown();
	} );

	test( 'a keyboard user reaching a rail loads it too', () => {
		// The flyout's documented keyboard entry point — the open arrow
		// on a tile — is registered inside `mountDockConstellation()`.
		// Waiting on `pointerover` alone meant a keyboard-only user
		// pressed it and got nothing, because the bundle carrying the
		// handler had never been requested.
		let loadCalls = 0;
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			() =>
				new Promise< void >( () => {
					loadCalls += 1;
				} ),
		);

		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		const tile = document.createElement( 'button' );
		dock.appendChild( tile );
		const elsewhere = document.createElement( 'div' );
		document.body.append( dock, elsewhere );

		const teardown = installDockConstellationSentinel( {
			bundleUrl: 'https://x.test/dock-constellation.js',
			deps: {} as Parameters< ConstellationApi[ 'mount' ] >[ 0 ],
		} );

		// `focusin` bubbles, so tabbing into the tile reaches the
		// document-level listener; focus landing elsewhere must not.
		elsewhere.dispatchEvent( new Event( 'focusin', { bubbles: true } ) );
		expect( loadCalls ).toBe( 0 );

		tile.dispatchEvent( new Event( 'focusin', { bubbles: true } ) );
		expect( loadCalls ).toBe( 1 );

		teardown();
	} );
} );
