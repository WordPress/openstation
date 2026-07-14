/**
 * Recycle Bin — selection identity across mixed entity types.
 *
 * Regression coverage for the cross-type id collision: the bin lists
 * posts and comments together, and their numeric id sequences are
 * independent (wp_posts vs wp_comments), so post #5 and comment #5
 * routinely coexist. Row identity (and therefore `<wpd-table>`
 * selection keys) must be type-qualified — with bare numeric ids,
 * ticking the post's checkbox also selected the comment, and a bulk
 * "Delete forever" permanently purged BOTH.
 *
 * The suite mounts the real `renderRecycleBin()` against the real
 * `<wpd-table>` in jsdom, with the REST layer mocked at the module
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
import type { WpdTable } from '../../src/ui/components/wpd-table/wpd-table';
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
	<div data-desktop-mode-recycle-bin-root>
		<wpd-segmented data-desktop-mode-recycle-bin-filter></wpd-segmented>
		<wpd-text-field data-desktop-mode-recycle-bin-search></wpd-text-field>
		<div data-desktop-mode-recycle-bin-bulk hidden>
			<span data-desktop-mode-recycle-bin-count></span>
			<button data-desktop-mode-recycle-bin-restore-selected></button>
			<button data-desktop-mode-recycle-bin-pin-to-desktop></button>
			<button data-desktop-mode-recycle-bin-purge-selected></button>
		</div>
		<button data-desktop-mode-recycle-bin-refresh></button>
		<wpd-table data-desktop-mode-recycle-bin-table selectable="multi" loading></wpd-table>
	</div>
`;

describe( 'recycle-bin selection identity', () => {
	let body: HTMLElement;
	let table: WpdTable< RecycleBinItem >;

	beforeEach( async () => {
		vi.clearAllMocks();
		( window as unknown as { wp: unknown } ).wp = {
			desktop: { confirm: async () => true },
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
		table = body.querySelector( '[data-desktop-mode-recycle-bin-table]' ) as WpdTable< RecycleBinItem >;
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

	test( 'bulk "Delete forever" purges only the selected {id, type} pair', async () => {
		const postCb = table.shadowRoot!.querySelector< HTMLInputElement >(
			'tr[data-row-id="post:5"] input.select-row-checkbox',
		)!;
		postCb.checked = true;
		postCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await settle();

		body
			.querySelector( '[data-desktop-mode-recycle-bin-purge-selected]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();

		expect( mocks.purgeItems ).toHaveBeenCalledTimes( 1 );
		expect( mocks.purgeItems ).toHaveBeenCalledWith( [
			{ id: 5, type: 'post' },
		] );
	} );
} );
