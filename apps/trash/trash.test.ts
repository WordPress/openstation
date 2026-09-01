/**
 * Trash app — the client view: the toolbar/empty-state switch, the
 * Media segment's MEDIA_TRASH gate, the bulk bar, the table wiring
 * (shared columns, composite row identity, fingerprint-guarded data
 * assignment), and the dock badge.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext, renderedText } from '../../src/app-runtime/testing';
import type { RecycleBinItem } from '../../src/recycle-bin/rest';
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
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the trash app view', () => {
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
		// The mount render already assigned and set the fingerprint —
		// re-rendering the same rows must not assign again.
		app.render( ctx );
		expect( assignments ).toBe( 0 );
		// A row changed — reassigned.
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
		expect( setIcon ).toHaveBeenCalledWith( 'trash', 'data:image/svg+xml;base64,FULL' );
		// Same state again — no re-push.
		app.render( ctx );
		expect( setIcon ).toHaveBeenCalledTimes( 1 );
		// The bin empties — the empty art goes up.
		ctx.data.items = [];
		ctx.data.total = 0;
		app.render( ctx );
		expect( setIcon ).toHaveBeenLastCalledWith( 'trash', 'data:image/svg+xml;base64,EMPTY' );
		// A count on the tile reads as update notifications.
		expect( setBadge ).not.toHaveBeenCalled();
	} );

	it( 'paints the empty-progress label declaratively', async () => {
		const { root, ctx } = mount();
		type UiBag = { empty: { mode: string; purged: number; total: number } };
		( ctx.ui( () => ( {} ) ) as UiBag ).empty = { mode: 'progress', purged: 12, total: 40 };
		app.render( ctx );
		// Let any upgraded kit components finish their microtask paint.
		await Promise.resolve();
		expect( renderedText( root ) ).toContain( 'Emptying… 12 of 40' );
	} );

	it( 'declares no local actions — every mutation is the server’s', () => {
		expect( app.hasLocal( 'restore' ) ).toBe( false );
		expect( app.hasLocal( 'purge' ) ).toBe( false );
	} );
} );
