/**
 * Recycle Bin — chrome hides while the bin is empty.
 *
 * Filters, search, sorting and Empty Trash all act on a list. With
 * nothing in the bin there is no list, so the toolbar and the table
 * (whose header carries the sort controls) both go.
 *
 * What the suite really guards is which count drives that: the
 * endpoint's `total` counts the whole bin, not the slice the active
 * filter or search returned. A search that matches nothing has to
 * keep the toolbar, or there is no way back out of it.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted( () => ( {
	fetchList: vi.fn(),
	purgeItems: vi.fn(),
	restoreItems: vi.fn(),
	emptyBin: vi.fn(),
} ) );

vi.mock( '../../src/recycle-bin/rest', () => mocks );
vi.mock( '../../src/recycle-bin/icon-state', () => ( {
	setRecycleBinCount: vi.fn(),
	_currentRecycleBinCount: () => 0,
} ) );
vi.mock( '../../src/recycle-bin/realtime', () => ( {
	start: vi.fn(),
	stop: vi.fn(),
} ) );

import { renderRecycleBin } from '../../src/recycle-bin/index';
import type { RecycleBinItem } from '../../src/recycle-bin/rest';

const settle = async (): Promise< void > => {
	for ( let i = 0; i < 6; i++ ) {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	}
};

const ITEM = { id: 7, type: 'post', title: 'Trashed post' } as RecycleBinItem;

const TEMPLATE = `
	<div data-os-recycle-bin-root>
		<header data-os-recycle-bin-toolbar>
			<os-segmented data-os-recycle-bin-filter></os-segmented>
			<os-text-field data-os-recycle-bin-search></os-text-field>
			<button data-os-recycle-bin-refresh></button>
			<button data-os-recycle-bin-empty></button>
		</header>
		<div data-os-recycle-bin-empty-state hidden></div>
		<os-table data-os-recycle-bin-table selectable="multi" loading></os-table>
	</div>
`;

describe( 'recycle-bin empty-state chrome', () => {
	let body: HTMLElement;

	/** `[ toolbar.hidden, table.hidden, emptyState.hidden ]`. */
	const shown = (): boolean[] =>
		[
			'[data-os-recycle-bin-toolbar]',
			'[data-os-recycle-bin-table]',
			'[data-os-recycle-bin-empty-state]',
		].map( ( sel ) => body.querySelector< HTMLElement >( sel )!.hidden );

	/** Re-fetch with whatever `fetchList` is currently mocked to return. */
	const refresh = async (): Promise< void > => {
		body
			.querySelector( '[data-os-recycle-bin-refresh]' )!
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await settle();
	};

	beforeEach( async () => {
		vi.clearAllMocks();
		( window as unknown as { wp: unknown } ).wp = {
			os: { confirm: async () => true },
		};
		mocks.fetchList.mockResolvedValue( { items: [ ITEM ], total: 1 } );

		document.body.innerHTML = '';
		body = document.createElement( 'div' );
		body.innerHTML = TEMPLATE;
		document.body.appendChild( body );
		renderRecycleBin( body );
		await settle();
	} );

	test( 'a bin with items shows the toolbar and the table', () => {
		expect( shown() ).toEqual( [ false, false, true ] );
	} );

	test( 'emptying the bin leaves the empty state and nothing else', async () => {
		mocks.fetchList.mockResolvedValue( { items: [], total: 0 } );
		await refresh();

		expect( shown() ).toEqual( [ true, true, false ] );
	} );

	test( 'a search matching nothing keeps the toolbar reachable', async () => {
		// `total` still reports the whole bin; only the returned slice
		// is empty. Hiding the toolbar here would strand the user in a
		// search they can no longer clear.
		mocks.fetchList.mockResolvedValue( { items: [], total: 1 } );
		await refresh();

		expect( shown() ).toEqual( [ false, false, true ] );
	} );
} );
