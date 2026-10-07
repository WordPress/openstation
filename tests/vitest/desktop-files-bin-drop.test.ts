import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import { doAction, HOOKS } from '../../src/hooks';

type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );
type BinTargetsModule = typeof import( '../../src/desktop-files/recycle-bin-targets' );

async function load(): Promise< {
	store: StoreModule;
	rest: RestModule;
	binTargets: BinTargetsModule;
} > {
	return {
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
		binTargets: await import( '../../src/desktop-files/recycle-bin-targets' ),
	};
}

const placement = ( id: number, type = 'post' ) => ( {
	id,
	parentId: 0,
	x: 100,
	y: 100,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type,
		ref: String( id ),
		title: `Item ${ id }`,
		icon: 'dashicons-admin-post',
		previewUrl: '',
		exists: true,
	},
} );

function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
	target: HTMLElement | Document = document,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target instanceof HTMLElement ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

function installManagerOnWindow( manager: DragManager ): void {
	const wp = ( window as unknown as { wp?: { hooks?: unknown; os?: Record< string, unknown > } } ).wp ?? {};
	wp.os = ( wp.os as Record< string, unknown > | undefined ) ?? {};
	( wp.os as { dragManager: DragManager } ).dragManager = manager;
	( window as unknown as { wp: typeof wp } ).wp = wp;
}

describe( 'recycle-bin dock icon drop (user regression)', () => {
	beforeEach( async () => {
		installHooksStub();
		__resetRecoveryForTests();
		const mod = await import( '../../src/desktop-files/recycle-bin-targets' );
		mod.__resetRecycleBinDropTargetsForTests();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'dropping a desktop-file on the bin dock icon issues REST DELETE', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( { deleted: true } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const dockTile = document.createElement( 'div' );
		dockTile.classList.add(
			'os-dock__item',
			'os-dock__item--system',
		);
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );

		binTargets.installRecycleBinDropTargets( manager );

		const targets = manager.debug().listTargets();
		expect( targets.find( ( t ) => t.id === 'recycle-bin-dock' ) ).toBeDefined();

		const p = placement( 7, 'link' );
		store.setFolderPlacements( 0, [ p ] );

		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 280 && x < 340 && y >= 280 && y < 340 ) {
				return innerBtn;
			}
			return null;
		};

		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: p,
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
			onCommit,
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );

		expect(
			dockTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( true );
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );

		expect( onCommit ).toHaveBeenCalledTimes( 1 );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const deletes = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'DELETE' && String( call[ 0 ] ).endsWith( '/placements/7' );
		} );
		expect( deletes.length ).toBe( 1 );

		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );

		expect(
			dockTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( false );
	} );

	test( 'an uploaded file from a folder drops into the asynchronously mounted Trash app', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		let respond!: ( response: Response ) => void;
		const fetchSpy = vi.fn( () => new Promise< Response >( ( resolve ) => {
			respond = resolve;
		} ) );
		vi.stubGlobal( 'fetch', fetchSpy );
		const manager = new DragManager();
		installManagerOnWindow( manager );
		const area = document.createElement( 'div' );
		area.id = 'os-area';
		document.body.appendChild( area );
		binTargets.installRecycleBinDropTargets( manager );
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		area.appendChild( win );
		doAction( HOOKS.WINDOW_OPENED, { windowId: 'desktop-mode-recycle-bin' } );
		await Promise.resolve();
		expect( manager.debug().listTargets().find( ( t ) => t.id === 'recycle-bin-window' ) ).toBeUndefined();

		const body = document.createElement( 'div' );
		body.setAttribute( 'data-os-recycle-bin-root', '' );
		const tableCell = document.createElement( 'div' );
		body.appendChild( tableCell );
		win.appendChild( body );
		await Promise.resolve();
		expect( manager.debug().listTargets().find( ( t ) => t.id === 'recycle-bin-window' )?.element ).toBe( body );

		const p = { ...placement( 701, 'upload' ), parentId: 42 };
		store.setFolderPlacements( 42, [ p ] );
		const source = document.createElement( 'div' );
		area.appendChild( source );
		document.elementFromPoint = () => tableCell;
		const onCommit = vi.fn();
		manager.start( {
			payload: { type: 'desktop-file', source, data: { placement: p, sourceFolderId: 42 } },
			origin: pointerEvent( 'pointerdown', 100, 100, source ),
			onCommit,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );
		expect( body.hasAttribute( 'data-os-trash-drop-active' ) ).toBe( true );
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
		expect( store.getFilesState().placementsByFolder.get( 42 ) ).toEqual( [] );
		expect( fetchSpy ).toHaveBeenCalledWith(
		'https://example.test/files/placements/701', expect.objectContaining( { method: 'DELETE' } ),
		);
		respond( new Response( JSON.stringify( { deleted: true } ), { status: 200 } ) );
		await Promise.resolve();
	} );

	test( 'Trash body registration follows replacements, close and reopen without another open event', async () => {
		const { binTargets } = await load();
		const manager = new DragManager();
		installManagerOnWindow( manager );
		const area = document.createElement( 'div' );
		area.id = 'os-area';
		document.body.appendChild( area );
		const body = document.createElement( 'div' );
		body.setAttribute( 'data-os-recycle-bin-root', '' );
		area.appendChild( body );
		binTargets.installRecycleBinDropTargets( manager );
		const target = () => manager.debug().listTargets().find( ( t ) => t.id === 'recycle-bin-window' );
		expect( target()?.element ).toBe( body );
		const replacement = body.cloneNode() as HTMLElement;
		body.replaceWith( replacement );
		await Promise.resolve();
		expect( target()?.element ).toBe( replacement );
		expect( manager.debug().listTargets().filter( ( t ) => t.id === 'recycle-bin-window' ) ).toHaveLength( 1 );
		replacement.remove();
		await Promise.resolve();
		expect( target() ).toBeUndefined();
		area.appendChild( body );
		await Promise.resolve();
		expect( target()?.element ).toBe( body );
	} );

	test( 'dropping a SET on the bin trashes every item in it', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );

		const fetchSpy = vi.fn(
			async () =>
				new Response( JSON.stringify( { deleted: true } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );
		binTargets.installRecycleBinDropTargets( manager );

		const a = placement( 11, 'link' );
		const b = placement( 12, 'link' );
		const c = placement( 13, 'link' );
		store.setFolderPlacements( 0, [ a, b, c ] );

		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );
		document.elementFromPoint = ( x, y ) =>
			x >= 280 && x < 340 && y >= 280 && y < 340 ? innerBtn : null;

		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: a,
					placements: [ a, b, c ],
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const deleted = fetchSpy.mock.calls
			.filter(
				( call ) =>
					( call[ 1 ] as RequestInit | undefined )?.method === 'DELETE',
			)
			.map( ( call ) => String( call[ 0 ] ) );
		for ( const id of [ 11, 12, 13 ] ) {
			expect(
				deleted.some( ( u ) => u.endsWith( `/placements/${ id }` ) ),
			).toBe( true );
		}

		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );
	} );

	test( 'a set containing an un-trashable item is refused whole', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response( '{}', {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					} ),
			),
		);

		const manager = new DragManager();
		installManagerOnWindow( manager );
		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );
		binTargets.installRecycleBinDropTargets( manager );

		const ok = placement( 21, 'link' );

		const denied = { ...placement( 22, 'link' ), canTrash: false };
		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );
		document.elementFromPoint = ( x, y ) =>
			x >= 280 && x < 340 && y >= 280 && y < 340 ? innerBtn : null;

		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: ok,
					placements: [ ok, denied ],
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
			onCommit,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );

		expect( dockTile.hasAttribute( 'data-os-trash-drop-active' ) ).toBe(
			false,
		);
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );
		expect( onCommit ).not.toHaveBeenCalled();
	} );

	test( 'dragging the recycle bin onto itself is rejected — no self-trash', async () => {

		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( { deleted: true } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const binTile = document.createElement( 'div' );
		binTile.classList.add( 'os-file-tile' );
		binTile.dataset.fileRef = 'desktop-mode-recycle-bin';
		document.body.appendChild( binTile );

		binTargets.installRecycleBinDropTargets( manager );
		expect(
			manager.debug().listTargets().find( ( t ) => t.id === 'recycle-bin-tile' ),
		).toBeDefined();

		const binPlacement = {
			id: 99,
			parentId: 0,
			x: 0,
			y: 0,
			sortOrder: 0,
			updatedAtMs: 1,
			meta: null,
			file: {
				type: 'shortcut',
				ref: 'desktop-mode-recycle-bin',
				title: 'Recycle Bin',
				icon: 'dashicons-trash',
				previewUrl: '',
				exists: true,
			},
		};
		store.setFolderPlacements( 0, [ binPlacement ] );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 280 && x < 340 && y >= 280 && y < 340 ) {
				return binTile;
			}
			return null;
		};

		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: binTile,
				data: {
					placement: binPlacement,
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, binTile ),
			onCommit,
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );

		expect(
			binTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( false );

		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );

		expect( onCommit ).not.toHaveBeenCalled();

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const deletes = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'DELETE';
		} );
		expect( deletes.length ).toBe( 0 );

		const remaining = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( remaining.find( ( p ) => p.id === 99 ) ).toBeDefined();
	} );

	test( 'bin drop target re-registers after a dock re-render', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		vi.stubGlobal( 'fetch', vi.fn( async () =>
			new Response( JSON.stringify( { deleted: true } ), { status: 200 } ),
		) );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const tile1 = document.createElement( 'div' );
		tile1.classList.add( 'os-dock__item' );
		tile1.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( tile1 );

		binTargets.installRecycleBinDropTargets( manager );
		expect(
			manager
				.debug()
				.listTargets()
				.find( ( t ) => t.id === 'recycle-bin-dock' )?.element,
		).toBe( tile1 );

		tile1.remove();
		const tile2 = document.createElement( 'div' );
		tile2.classList.add( 'os-dock__item' );
		tile2.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( tile2 );

		( window as unknown as { wp: { hooks: { doAction: ( h: string, ...a: unknown[] ) => void } } } )
			.wp.hooks.doAction( HOOKS.DOCK_AFTER_RENDER, {} );

		expect(
			manager
				.debug()
				.listTargets()
				.find( ( t ) => t.id === 'recycle-bin-dock' )?.element,
		).toBe( tile2 );
	} );
	test( 'every bin surface gets its own target, not just the first', async () => {

		const { binTargets } = await load();
		const manager = new DragManager();
		installManagerOnWindow( manager );

		const wallpaperTile = document.createElement( 'div' );
		wallpaperTile.classList.add( 'os-file-tile' );
		wallpaperTile.dataset.fileRef = 'desktop-mode-recycle-bin';
		document.body.appendChild( wallpaperTile );

		const legacyIcon = document.createElement( 'button' );
		legacyIcon.dataset.iconId = 'desktop-mode-recycle-bin';
		document.body.appendChild( legacyIcon );

		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( dockTile );

		binTargets.installRecycleBinDropTargets( manager );

		const byId = ( id: string ) =>
			manager.debug().listTargets().find( ( t ) => t.id === id )?.element;
		expect( byId( 'recycle-bin-tile' ) ).toBe( wallpaperTile );
		expect( byId( 'recycle-bin-icon' ) ).toBe( legacyIcon );
		expect( byId( 'recycle-bin-dock' ) ).toBe( dockTile );

		wallpaperTile.remove();
		( window as unknown as { wp: { hooks: { doAction: ( h: string, ...a: unknown[] ) => void } } } )
			.wp.hooks.doAction( HOOKS.DOCK_AFTER_RENDER, {} );
		expect( byId( 'recycle-bin-tile' ) ).toBeUndefined();
		expect( byId( 'recycle-bin-dock' ) ).toBe( dockTile );
	} );
} );
