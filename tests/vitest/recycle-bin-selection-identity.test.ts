/**
 * Recycle Bin — selection identity across mixed entity types.
 *
 * Regression coverage for the cross-type id collision: the bin lists
 * posts and comments together, and their numeric id sequences are
 * independent (wp_posts vs wp_comments), so post #5 and comment #5
 * routinely coexist. Row identity (and therefore `<os-table>`
 * selection keys) must be type-qualified — with bare numeric ids,
 * ticking the post's checkbox also selected the comment, and a bulk
 * "Delete forever" permanently purged BOTH.
 *
 * The suite mounts the real `renderRecycleBin()` against the real
 * `<os-table>` in jsdom, with the REST layer mocked at the module
 * boundary, and drives the checkbox + bulk-purge flow end to end.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted( () => ( {
	fetchList: vi.fn(),
	purgeItems: vi.fn(),
	restoreItems: vi.fn(),
	emptyBin: vi.fn(),
} ) );

vi.mock( '../../src/recycle-bin/rest', () => mocks );
vi.mock( '../../src/recycle-bin/badge', () => ( {
	setRecycleBinBadge: vi.fn(),
} ) );
vi.mock( '../../src/recycle-bin/realtime', () => ( {
	start: vi.fn(),
	stop: vi.fn(),
} ) );

import { renderRecycleBin } from '../../src/recycle-bin/index';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import type { RecycleBinItem } from '../../src/recycle-bin/rest';

/** Flush pending promises + the microtask paint queue a few times. */
const settle = async (): Promise< void > => {
	for ( let i = 0; i < 6; i++ ) {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	}
};

const makeItem = (
	overrides: Partial< RecycleBinItem > & Pick< RecycleBinItem, 'id' | 'type' | 'title' >,
): RecycleBinItem => ( {
	subtitle: '',
	mime: '',
	preview: '',
	icon: '',
	deleted_at: '2026-07-01T10:00:00',
	deleted_by: 'admin',
	deleted_by_id: 1,
	can_restore: true,
	can_purge: true,
	edit_link: '',
	...overrides,
} );

const TEMPLATE = `
	<div data-os-recycle-bin-root>
		<os-segmented data-os-recycle-bin-filter></os-segmented>
		<os-text-field data-os-recycle-bin-search></os-text-field>
		<div data-os-recycle-bin-bulk hidden>
			<span data-os-recycle-bin-count></span>
			<button data-os-recycle-bin-restore-selected></button>
			<button data-os-recycle-bin-pin-to-desktop></button>
			<button data-os-recycle-bin-purge-selected></button>
		</div>
		<button data-os-recycle-bin-refresh></button>
		<os-table data-os-recycle-bin-table selectable="multi" loading></os-table>
	</div>
`;

const createPlacement = vi.fn();

describe( 'recycle-bin selection identity', () => {
	let body: HTMLElement;
	let table: OsTable< RecycleBinItem >;

	beforeEach( async () => {
		vi.clearAllMocks();
		( window as unknown as { wp: unknown } ).wp = {
			os: {
				confirm: async () => true,
				files: { rest: { createPlacement } },
			},
		};
		mocks.fetchList.mockResolvedValue( {
			items: [
				makeItem( { id: 5, type: 'post', title: 'Trashed post' } ),
				makeItem( { id: 5, type: 'comment', title: 'Trashed comment' } ),
			],
			total: 2,
		} );
		mocks.purgeItems.mockResolvedValue( { ok: [ 5 ], errors: [] } );
		mocks.restoreItems.mockResolvedValue( { ok: [ 5 ], errors: [] } );

		document.body.innerHTML = '';
		body = document.createElement( 'div' );
		body.innerHTML = TEMPLATE;
		document.body.appendChild( body );

		renderRecycleBin( body );
		await settle();
		table = body.querySelector( '[data-os-recycle-bin-table]' ) as OsTable< RecycleBinItem >;
	} );

	test( 'post #5 and comment #5 get distinct, type-qualified row ids', () => {
		const rows = table.shadowRoot!.querySelectorAll< HTMLElement >(
			'tbody tr[data-row-id]',
		);
		const ids = Array.from( rows, ( tr ) => tr.dataset.rowId ).sort();
		expect( ids ).toEqual( [ 'comment:5', 'post:5' ] );
	} );

	test( 'selecting the post does NOT select the same-id comment', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();

		const commentRow = table.shadowRoot!.querySelector< HTMLElement >(
			'tr[data-row-id="comment:5"]',
		)!;
		expect( commentRow.classList.contains( 'is-selected' ) ).toBe( false );
		expect(
			commentRow.querySelector< HTMLInputElement >(
				'input.select-row-checkbox',
			)!.checked,
		).toBe( false );
		expect( Array.from( table.selection ) ).toEqual( [ 'post:5' ] );
	} );

	test( 'changing a client-side column filter clears the selection', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();
		expect( table.selection.size ).toBe( 1 );

		// Type into the Title column filter — the previously selected
		// row may now be hidden while still present in `data`, so the
		// app must drop the selection rather than let it ride into a
		// bulk purge the user can't see.
		const input = table.shadowRoot!.querySelector< HTMLInputElement >(
			'.filter-input',
		)!;
		input.value = 'comment';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		await settle();

		expect( table.selection.size ).toBe( 0 );
	} );

	test( 'a refresh prunes selection keys whose row left the list', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();
		expect( Array.from( table.selection ) ).toEqual( [ 'post:5' ] );

		// Someone else purges post #5; a realtime-driven refresh
		// replaces the list. The ghost key must not linger in the
		// selection (it would overcount the bulk bar).
		mocks.fetchList.mockResolvedValue( {
			items: [
				makeItem( { id: 5, type: 'comment', title: 'Trashed comment' } ),
			],
			total: 1,
		} );
		body
			.querySelector( '[data-os-recycle-bin-refresh]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();

		expect( table.selection.size ).toBe( 0 );
	} );

	test( 'bulk "Delete forever" purges only the selected {id, type} pair', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();

		body
			.querySelector( '[data-os-recycle-bin-purge-selected]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();

		expect( mocks.purgeItems ).toHaveBeenCalledTimes( 1 );
		expect( mocks.purgeItems ).toHaveBeenCalledWith( [
			{ id: 5, type: 'post' },
		] );
	} );

	test( 'a selected row hidden by a DATA-driven filter mismatch is not purgeable', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();

		// Programmatic filter assignment does NOT fire
		// `os-table-filter-change` — this simulates a data-driven
		// visibility change (e.g. a realtime refresh replaced the row
		// with a title that no longer matches an already-active column
		// filter). The selected post is now hidden but still in `data`.
		table.filters = { title: 'comment' };
		await settle();

		body
			.querySelector( '[data-os-recycle-bin-purge-selected]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();

		// Nothing visible was selected → no confirm, no purge.
		expect( mocks.purgeItems ).not.toHaveBeenCalled();
	} );

	test( 'pin-to-desktop restores per ref and never places a same-id item whose restore failed', async () => {
		// Post #5 restores fine; comment #5 is refused. A batched
		// restore's bare-numeric `ok: [5]` could not tell these apart.
		mocks.restoreItems.mockImplementation(
			async ( refs: Array< { id: number; type: string } > ) =>
				refs[ 0 ].type === 'post'
					? { ok: [ 5 ], errors: [] }
					: {
						ok: [],
						errors: [
							{ id: 5, code: 'forbidden', message: 'nope' },
						],
					},
		);

		for ( const key of [ 'post:5', 'comment:5' ] ) {
			const cb = table.shadowRoot!.querySelector< HTMLInputElement >(
				`tr[data-row-id="${ key }"] input.select-row-checkbox`,
			)!;
			cb.checked = true;
			cb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		}
		await settle();

		body
			.querySelector( '[data-os-recycle-bin-pin-to-desktop]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();

		// One restore call per ref (unambiguous success signal)…
		expect( mocks.restoreItems ).toHaveBeenCalledTimes( 2 );
		expect( mocks.restoreItems ).toHaveBeenNthCalledWith( 1, [
			{ id: 5, type: 'post' },
		] );
		expect( mocks.restoreItems ).toHaveBeenNthCalledWith( 2, [
			{ id: 5, type: 'comment' },
		] );
		// …and only the successfully restored post gets a tile.
		expect( createPlacement ).toHaveBeenCalledTimes( 1 );
		expect( createPlacement ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'post', ref: '5' } ),
		);
	} );
} );
