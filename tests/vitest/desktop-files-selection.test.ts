/**
 * Multi-selection on the files layer: the Finder right-click rule,
 * the intersected action set for a mixed selection, and selection
 * survival across the layer's repaint paths.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type LayerModule = typeof import( '../../src/desktop-files/layer' );
type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );

async function load(): Promise< {
	layer: LayerModule;
	store: StoreModule;
	rest: RestModule;
} > {
	vi.resetModules();
	return {
		layer: await import( '../../src/desktop-files/layer' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
	};
}

const placement = (
	id: number,
	type: 'post' | 'attachment' | 'folder' = 'post',
	overrides: Record< string, unknown > = {},
) => ( {
	id,
	parentId: 0,
	x: id * 100,
	y: 0,
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
	...overrides,
} );

function stubRest() {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(
					JSON.stringify( { placements: [], folderId: 0 } ),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				),
		),
	);
}

async function mount(
	placements: ReturnType< typeof placement >[],
): Promise< {
	host: HTMLElement;
	handle: ReturnType< LayerModule[ 'mountFilesLayer' ] >;
	store: StoreModule;
} > {
	const { layer, store, rest } = await load();
	store.__resetFilesStoreForTests();
	rest.installRestDeps( {
		baseUrl: 'https://example.test/files',
		nonce: 'n',
	} );
	stubRest();
	store.setFolderPlacements( 0, placements as never );
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	const handle = layer.mountFilesLayer( host, 0 );
	return { host, handle, store };
}

function tileFor( host: HTMLElement, id: number ): HTMLElement {
	const el = host.querySelector< HTMLElement >(
		`[data-placement-id="${ id }"]`,
	);
	if ( ! el ) {
		throw new Error( `no tile for placement ${ id }` );
	}
	return el;
}

function click( el: Element, init: MouseEventInit = {} ): void {
	el.dispatchEvent( new MouseEvent( 'click', { bubbles: true, ...init } ) );
}

function rightClick( el: Element ): void {
	el.dispatchEvent(
		new MouseEvent( 'contextmenu', {
			bubbles: true,
			clientX: 10,
			clientY: 10,
		} ),
	);
}

function menuItemIds(): string[] {
	const menu = document.querySelector( 'os-context-menu' );
	return Array.from(
		menu?.querySelectorAll( 'os-context-menu-option' ) ?? [],
	).map( ( o ) => ( o as HTMLElement ).dataset.menuItemId ?? '' );
}

function menuLabels(): string[] {
	const menu = document.querySelector( 'os-context-menu' );
	return Array.from(
		menu?.querySelectorAll( 'os-context-menu-option' ) ?? [],
	).map( ( o ) => o.textContent ?? '' );
}

describe( 'files layer multi-selection', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	} );

	test( 'ctrl-click builds a selection the handle reports', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
			placement( 3 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );
		handle.dispose();
	} );

	test( 'onSelectionChange reports null for a multi-selection', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		const single: unknown[] = [];
		handle.onSelectionChange( ( p ) => single.push( p?.id ?? null ) );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		expect( single ).toEqual( [ 1, null ] );
		handle.dispose();
	} );

	test( 'onSelectionChanged reports the whole set', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		const sets: number[][] = [];
		handle.onSelectionChanged( ( ps ) => sets.push( ps.map( ( p ) => p.id ) ) );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		expect( sets ).toEqual( [ [ 1 ], [ 1, 2 ] ] );
		handle.dispose();
	} );

	test( 'right-click outside the selection replaces it', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
			placement( 3 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		rightClick( tileFor( host, 3 ) );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 3 ] );
		handle.dispose();
	} );

	test( 'right-click inside the selection keeps it', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		rightClick( tileFor( host, 2 ) );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );
		handle.dispose();
	} );

	test( 'a single-tile menu still lists the per-type actions', async () => {
		const { host, handle } = await mount( [ placement( 1, 'post' ) ] );
		rightClick( tileFor( host, 1 ) );
		expect( menuItemIds() ).toEqual( [
			'open',
			'navigate-into',
			'remove',
		] );
		handle.dispose();
	} );

	test( 'a post + an attachment keep Open and Trash, drop the rest', async () => {
		const { host, handle } = await mount( [
			placement( 1, 'post' ),
			placement( 2, 'attachment' ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		rightClick( tileFor( host, 2 ) );
		expect( menuItemIds() ).toEqual( [ 'open', 'trash' ] );
		expect( menuLabels() ).toEqual( [
			'Open 2 items',
			'Move 2 items to Trash',
		] );
		handle.dispose();
	} );

	test( 'a folder + a post still share one Trash entry', async () => {
		const { host, handle } = await mount( [
			placement( 1, 'folder' ),
			placement( 2, 'post' ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		rightClick( tileFor( host, 1 ) );
		// `delete-folder` and `remove` merge on `multiId: 'trash'`;
		// rename and navigate-into are single-item and drop out.
		expect( menuItemIds() ).toEqual( [ 'open', 'trash' ] );
		handle.dispose();
	} );

	test( 'the menu records every placement it acts on', async () => {
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		rightClick( tileFor( host, 1 ) );
		const menu = document.querySelector< HTMLElement >( 'os-context-menu' );
		expect( menu?.dataset.placementIds ).toBe( '1,2' );
		handle.dispose();
	} );

	test( 'selection survives an incremental repaint', async () => {
		const { host, handle, store } = await mount( [
			placement( 1 ),
			placement( 2 ),
			placement( 3 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		// A peer adds a placement — the incremental path reuses the
		// existing tiles.
		store.upsertPlacement( placement( 4 ) as never, 'remote' );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );
		expect( tileFor( host, 1 ).hasAttribute( 'selected' ) ).toBe( true );
		handle.dispose();
	} );

	test( 'a deleted placement drops out of the selection', async () => {
		const { host, handle, store } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );
		store.removePlacement( 2, 'remote' );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1 ] );
		handle.dispose();
	} );

	test( 'a modifier click does not lift a drag', async () => {
		const started = vi.fn();
		// Attach to the existing `wp` (the hooks stub lives there);
		// replacing it wholesale would strip `wp.hooks` and the tile
		// renderer's filters would throw.
		const wp = ( window as unknown as { wp: Record< string, unknown > } ).wp;
		const previousOs = wp.os;
		wp.os = {
			dragManager: {
				start: started,
				registerDropTarget: () => () => undefined,
			},
		};
		const { host, handle } = await mount( [
			placement( 1 ),
			placement( 2 ),
		] );
		const ev = new Event( 'pointerdown', { bubbles: true } );
		Object.defineProperty( ev, 'button', { value: 0 } );
		Object.defineProperty( ev, 'metaKey', { value: true } );
		Object.defineProperty( ev, 'clientX', { value: 5 } );
		Object.defineProperty( ev, 'clientY', { value: 5 } );
		tileFor( host, 2 ).dispatchEvent( ev );
		expect( started ).not.toHaveBeenCalled();
		handle.dispose();
		wp.os = previousOs;
	} );
} );
