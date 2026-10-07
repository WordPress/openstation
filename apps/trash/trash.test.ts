import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext, renderedText } from '../../src/app-runtime/testing';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { beginTrashChange, trashItem, watchTrashChanges } from '../../src/desktop-files/trash-optimistic';
import type { RecycleBinItem } from './parts/types';
import app from './trash.os';

interface AppState extends Record< string, unknown > {
	filter: string;
	search: string;
}
interface AppData {
	items: RecycleBinItem[];
	total: number;
	mediaTrash: boolean;
}

function item( over: Partial< RecycleBinItem > = {} ): RecycleBinItem {
	return {
		id: 1,
		type: 'post',
		type_label: 'Post',
		title: 'Doomed post',
		subtitle: 'By Ada',
		mime: '',
		preview: '',
		icon: '',
		deleted_at: '2026-08-30 10:00:00',
		deleted_by: 'Ada',
		deleted_by_id: 3,
		can_restore: true,
		can_purge: true,
		edit_link: '',
		...over,
	};
}

function mount(
	state: Partial< AppState > = {},
	data: Partial< AppData > = {},
	extra: Record< string, unknown > = {},
) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( {
		state: { filter: '', search: '', ...state },
		data: { items: [ item() ], total: 1, mediaTrash: false, ...data },
		root,
		extra,
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx };
}

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = { os: {} };
} );

afterEach( () => {
	_resetAllSharedStoresForTests();
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the trash app view', () => {
	it( 'renders rows on the first open without another window loading the table component', async () => {
		const { root } = mount();
		const table = root.querySelector( '[data-os-trash-table]' )!;
		await Promise.resolve();
		await Promise.resolve();
		expect( customElements.get( 'os-table' ) ).toBeDefined();
		expect( table.shadowRoot?.textContent ).toContain( 'Doomed post' );
	} );

	it( 'reconciles an empty prewarmed snapshot when the bin opens', async () => {
		const { root, ctx } = mount( {}, { items: [], total: 0 } );
		ctx.dispatch = vi.fn( async () => {
			ctx.data.items = [ item() ];
			ctx.data.total = 1;
			ctx.repaint();
			return true;
		} );
		const dispose = app.mounted( ctx );
		await Promise.resolve();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'refresh' );
		expect( root.querySelector( 'os-empty-state' )!.hasAttribute( 'hidden' ) ).toBe( true );
		expect( ( root.querySelector( '[data-os-trash-table]' ) as HTMLElement & { data: RecycleBinItem[] } ).data ).toHaveLength( 1 );
		dispose?.();
	} );

	it( 'shows the toolbar + table against items, the empty state otherwise', () => {
		const { root } = mount();
		expect( root.querySelector( '.os-recycle-bin__toolbar' )!.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( 'os-empty-state' )!.hasAttribute( 'hidden' ) ).toBe( true );
		expect( root.querySelector( '[data-os-trash-table]' )!.hasAttribute( 'hidden' ) ).toBe( false );

		const empty = mount( {}, { items: [], total: 0 } );
		expect( empty.root.querySelector( '.os-recycle-bin__toolbar' )!.hasAttribute( 'hidden' ) ).toBe( true );
		expect( empty.root.querySelector( 'os-empty-state' )!.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	it( 'gates the Media segment on MEDIA_TRASH, like the legacy template', () => {
		const { root } = mount();
		const values = Array.from( root.querySelectorAll( 'os-segment' ) ).map( ( s ) =>
			s.getAttribute( 'value' ),
		);
		expect( values ).toEqual( [ '', 'post', 'page', 'comment', 'desktop' ] );

		const withMedia = mount( {}, { mediaTrash: true } );
		const withValues = Array.from( withMedia.root.querySelectorAll( 'os-segment' ) ).map(
			( s ) => s.getAttribute( 'value' ),
		);
		expect( withValues ).toContain( 'attachment' );
	} );

	it( 'the filter and the search both dispatch the built-in refresh', () => {
		const { root } = mount();
		expect( root.querySelector( 'os-segmented' )!.getAttribute( 'os-action' ) ).toBe( 'refresh' );
		expect( root.querySelector( 'os-segmented' )!.getAttribute( 'os-bind' ) ).toBe( 'filter' );
		const search = root.querySelector( 'os-text-field' )!;
		expect( search.getAttribute( 'os-action' ) ).toBe( 'refresh' );
		expect( search.getAttribute( 'os-bind' ) ).toBe( 'search' );
	} );

	it( 'wires the table once: shared columns, composite identity, deleted-at sort', () => {
		const { root, ctx } = mount();
		app.mounted( ctx );
		const table = root.querySelector( '[data-os-trash-table]' ) as HTMLElement & {
			columns?: Array< { key: string } >;
			getRowId?: ( row: RecycleBinItem ) => string;
			sort?: { key: string; direction: string };
			data?: RecycleBinItem[];
		};
		expect( table.hasAttribute( 'data-os-trash-wired' ) ).toBe( true );
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [
			'title',
			'deleted_at',
			'deleted_by',
			'__actions',
		] );
		expect( table.getRowId!( item( { id: 5, type: 'comment' } ) ) ).toBe( 'comment:5' );
		expect( table.sort ).toEqual( { key: 'deleted_at', direction: 'desc' } );
		expect( table.data ).toHaveLength( 1 );
	} );

	it( 'skips the table repaint when the data fingerprint is unchanged', () => {
		const { root, ctx } = mount();
		const table = root.querySelector( '[data-os-trash-table]' ) as HTMLElement & {
			data?: RecycleBinItem[];
		};
		let assignments = 0;
		let stored: RecycleBinItem[] | undefined = table.data;
		Object.defineProperty( table, 'data', {
			get: () => stored,
			set: ( value: RecycleBinItem[] ) => {
				assignments++;
				stored = value;
			},
		} );

		app.render( ctx );
		expect( assignments ).toBe( 0 );

		ctx.data.items = [ item( { deleted_at: '2026-08-31 09:00:00' } ) ];
		app.render( ctx );
		expect( assignments ).toBe( 1 );
	} );

	it( 'swaps the tile art as the count crosses zero — and never badges', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const ctx = mockViewContext< AppState, AppData >( {
			state: { filter: '', search: '' },
			data: { items: [ item() ], total: 7, mediaTrash: false },
			root,
			extra: {
				empty: 'data:image/svg+xml;base64,EMPTY',
				full: 'data:image/svg+xml;base64,FULL',
			},
		} );
		const setIcon = vi.fn();
		const setBadge = vi.fn();
		ctx.host.setIcon = setIcon;
		ctx.host.setBadge = setBadge;
		app.render( ctx );
		expect( setIcon ).toHaveBeenCalledWith( 'desktop-mode-recycle-bin', 'data:image/svg+xml;base64,FULL' );

		app.render( ctx );
		expect( setIcon ).toHaveBeenCalledTimes( 1 );

		ctx.data.items = [];
		ctx.data.total = 0;
		app.render( ctx );
		expect( setIcon ).toHaveBeenLastCalledWith( 'desktop-mode-recycle-bin', 'data:image/svg+xml;base64,EMPTY' );

		expect( setBadge ).not.toHaveBeenCalled();
	} );

	it( 'paints the empty-progress label declaratively', async () => {
		const { root, ctx } = mount();
		type UiBag = { empty: { mode: string; purged: number; total: number } };
		( ctx.ui( () => ( {} ) ) as UiBag ).empty = { mode: 'progress', purged: 12, total: 40 };
		app.render( ctx );

		await Promise.resolve();
		expect( renderedText( root ) ).toContain( 'Emptying… 12 of 40' );
	} );

	it( 'declares no local actions — every mutation is the server’s', () => {
		expect( app.hasLocal( 'restore' ) ).toBe( false );
		expect( app.hasLocal( 'purge' ) ).toBe( false );
	} );
} );

describe( 'the trash app on a phone', () => {
	beforeEach( () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
	} );
	afterEach( () => {
		document.documentElement.removeAttribute( 'data-os-mode' );
	} );

	it( 'lays the table out as cards, with labelled row buttons', () => {
		const { root } = mount();
		const table = root.querySelector( '[data-os-trash-table]' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		const columns = ( table as unknown as { columns: Array< { key: string; stack?: string } > } ).columns;
		expect( columns.map( ( c ) => [ c.key, c.stack ] ) ).toEqual( [
			[ 'title', 'title' ],
			[ 'deleted_at', 'meta' ],
			[ 'deleted_by', 'meta' ],
			[ '__actions', 'actions' ],
		] );
		const actions = columns.find( ( c ) => c.key === '__actions' ) as unknown as {
			render: ( v: unknown, row: RecycleBinItem ) => HTMLElement;
		};
		const cell = actions.render( undefined, item() );
		const labels = Array.from( cell.querySelectorAll( 'button' ) ).map( ( b ) => b.textContent?.trim() );
		expect( labels ).toEqual( [ 'Restore', 'Delete forever' ] );
	} );

	it( 'moves the selection actions to a bar along the bottom, without Pin to desktop', () => {
		const { root, ctx } = mount();
		expect( root.querySelector( '.os-recycle-bin__toolbar-right' ) ).toBeNull();
		const bar = root.querySelector( '.os-recycle-bin__bulk' )!;
		expect( bar ).not.toBeNull();
		expect( bar.hasAttribute( 'hidden' ) ).toBe( true );
		type UiBag = { selected: Array< { id: number; type: string } > };
		( ctx.ui( () => ( {} ) ) as UiBag ).selected = [ { id: 1, type: 'post' } ];
		app.render( ctx );
		const shown = root.querySelector( '.os-recycle-bin__bulk' )!;
		expect( shown.hasAttribute( 'hidden' ) ).toBe( false );
		const labels = Array.from( shown.querySelectorAll( 'os-button' ) ).map( ( b ) => b.textContent?.trim() );
		expect( labels ).toEqual( [ 'Restore', 'Delete forever' ] );
		expect( renderedText( shown ) ).toContain( '1 selected' );
	} );

	it( 'goes back to the grid when the stamp is lifted', () => {
		const { root, ctx } = mount();
		document.documentElement.removeAttribute( 'data-os-mode' );
		app.render( ctx );
		const table = root.querySelector( '[data-os-trash-table]' )!;
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( root.querySelector( '.os-recycle-bin__bulk' ) ).toBeNull();
		expect( root.querySelector( '.os-recycle-bin__toolbar-right' ) ).not.toBeNull();
	} );
} );

describe( 'optimistic Trash rows', () => {
	it( 'shows an incoming drop immediately and rolls it back on failure', async () => {
		const { root, ctx } = mount( {}, { items: [], total: 0 }, { full: 'full.svg', empty: 'empty.svg' } );
		const stop = watchTrashChanges( () => ctx.repaint() );
		ctx.host.setIcon = vi.fn();
		const operation = beginTrashChange( trashItem( { id: 5, type: 'post', title: 'Incoming' } ) )!;
		const table = root.querySelector( '[data-os-trash-table]' ) as HTMLElement & { data: RecycleBinItem[] };
		expect( table.data[ 0 ].title ).toBe( 'Incoming' );
		expect( table.data[ 0 ].can_restore ).toBe( false );
		expect( table.hasAttribute( 'hidden' ) ).toBe( false );
		expect( ctx.host.setIcon ).toHaveBeenCalledWith( 'desktop-mode-recycle-bin', 'full.svg' );
		await operation.finish( false );
		expect( table.data ).toEqual( [] );
		expect( ctx.host.setIcon ).toHaveBeenLastCalledWith( 'desktop-mode-recycle-bin', 'empty.svg' );
		stop();
	} );

	it( 'hides Restore immediately and brings the row back when dispatch fails', async () => {
		const { root, ctx } = mount();
		const stop = watchTrashChanges( () => ctx.repaint() );
		let answer!: ( ok: boolean ) => void;
		ctx.dispatch = vi.fn( () => new Promise< boolean >( ( resolve ) => {
			answer = resolve;
		} ) );
		const table = root.querySelector( '[data-os-trash-table]' ) as HTMLElement & {
			data: RecycleBinItem[];
			clearSelection: () => void;
			columns: Array< { key: string; render: ( value: unknown, row: RecycleBinItem ) => HTMLElement } >;
		};
		table.clearSelection = vi.fn();
		const cell = table.columns.find( ( column ) => column.key === '__actions' )!.render( null, item() );
		cell.querySelector< HTMLButtonElement >( '[aria-label="Restore"]' )!.click();
		expect( table.data ).toEqual( [] );
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'restore', { items: [ { id: 1, type: 'post' } ] } );
		answer( false );
		await vi.waitFor( () => expect( table.data ).toHaveLength( 1 ) );
		stop();
	} );

	it( 'does not optimistically remove a permanent deletion until confirmation', async () => {
		const { root, ctx } = mount();
		const stop = watchTrashChanges( () => ctx.repaint() );
		ctx.host.confirm = vi.fn( async () => false );
		ctx.dispatch = vi.fn( async () => true );
		const table = root.querySelector( '[data-os-trash-table]' ) as HTMLElement & {
			data: RecycleBinItem[];
			columns: Array< { key: string; render: ( value: unknown, row: RecycleBinItem ) => HTMLElement } >;
		};
		const cell = table.columns.find( ( column ) => column.key === '__actions' )!.render( null, item() );
		cell.querySelector< HTMLButtonElement >( '[aria-label="Delete forever"]' )!.click();
		await Promise.resolve();
		expect( table.data ).toHaveLength( 1 );
		expect( ctx.dispatch ).not.toHaveBeenCalled();
		stop();
	} );
} );
