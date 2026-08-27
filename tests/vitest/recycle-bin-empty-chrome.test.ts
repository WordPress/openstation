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
	currentCount: vi.fn( () => 0 ),
} ) );

vi.mock( '../../src/recycle-bin/rest', () => mocks );
vi.mock( '../../src/recycle-bin/icon-state', () => ( {
	setRecycleBinCount: vi.fn(),
	_currentRecycleBinCount: mocks.currentCount,
} ) );
vi.mock( '../../src/recycle-bin/realtime', () => ( {
	start: vi.fn(),
	stop: vi.fn(),
} ) );

import type { OsTable } from '../../src/ui/components/os-table/os-table';
import type { RecycleBinItem } from '../../src/recycle-bin/rest';

// Re-imported per test. `cachedItems` lives at module scope so a
// reopened window can repaint without a skeleton, which also means a
// test that loads rows leaves the next one warm — and "warm" is the
// one thing the cold-load cases here are about.
let renderRecycleBin: ( body: HTMLElement ) => void;

const settle = async (): Promise< void > => {
	for ( let i = 0; i < 6; i++ ) {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	}
};

const ITEM = { id: 7, type: 'post', title: 'Trashed post' } as RecycleBinItem;

const NO_MATCH = 'No items match the current filter or search.';

const TEMPLATE = `
	<div data-os-recycle-bin-root>
		<header data-os-recycle-bin-toolbar>
			<os-segmented data-os-recycle-bin-filter></os-segmented>
			<os-text-field data-os-recycle-bin-search></os-text-field>
			<button data-os-recycle-bin-refresh></button>
			<button data-os-recycle-bin-empty></button>
		</header>
		<os-empty-state data-os-recycle-bin-empty-state hidden></os-empty-state>
		<os-table data-os-recycle-bin-table selectable="multi" loading
			empty="${ NO_MATCH }"></os-table>
	</div>
`;

describe( 'recycle-bin empty-state chrome', () => {
	let body: HTMLElement;

	const el = ( sel: string ): HTMLElement =>
		body.querySelector< HTMLElement >( `[data-os-recycle-bin-${ sel }]` )!;

	/** `[ toolbar, table, emptyState ]` — true means visible. */
	const shown = (): boolean[] =>
		[ 'toolbar', 'table', 'empty-state' ].map( ( s ) => ! el( s ).hidden );

	/** Render without waiting, so the pre-fetch paint can be asserted. */
	const mount = (): void => {
		document.body.innerHTML = '';
		body = document.createElement( 'div' );
		body.innerHTML = TEMPLATE;
		document.body.appendChild( body );
		renderRecycleBin( body );
	};

	/** Re-fetch with whatever `fetchList` is currently mocked to return. */
	const refresh = async (): Promise< void > => {
		el( 'refresh' ).dispatchEvent(
			new MouseEvent( 'click', { bubbles: true } ),
		);
		await settle();
	};

	beforeEach( async () => {
		vi.clearAllMocks();
		vi.resetModules();
		( { renderRecycleBin } = await import( '../../src/recycle-bin/index' ) );
		mocks.currentCount.mockReturnValue( 0 );
		( window as unknown as { wp: unknown } ).wp = {
			os: { confirm: async () => true },
		};
		mocks.fetchList.mockResolvedValue( { items: [ ITEM ], total: 1 } );
	} );

	test( 'a bin with items shows the toolbar and the table', async () => {
		mount();
		await settle();

		expect( shown() ).toEqual( [ true, true, false ] );
	} );

	test( 'emptying the bin leaves the empty state and nothing else', async () => {
		mount();
		await settle();

		mocks.fetchList.mockResolvedValue( { items: [], total: 0 } );
		await refresh();

		expect( shown() ).toEqual( [ false, false, true ] );
	} );

	test( 'a search matching nothing keeps the toolbar reachable', async () => {
		mount();
		await settle();

		// `total` still reports the whole bin; only the returned slice
		// is empty. Hiding the toolbar here would strand the user in a
		// search they can no longer clear.
		mocks.fetchList.mockResolvedValue( { items: [], total: 1 } );
		await refresh();

		expect( shown() ).toEqual( [ true, true, false ] );
		expect( el( 'table' ).getAttribute( 'empty' ) ).toBe( NO_MATCH );
	} );

	describe( 'before the first response lands', () => {
		test( 'a seeded count of zero opens straight into the empty state', () => {
			mount();

			expect( shown() ).toEqual( [ false, false, true ] );
		} );

		test( 'a seeded count above zero opens with the chrome up', () => {
			mocks.currentCount.mockReturnValue( 3 );
			mount();

			// No skeleton-then-vanish: the toolbar is up on the first
			// paint, before `fetchList` has resolved.
			expect( shown() ).toEqual( [ true, true, false ] );
			expect( el( 'table' ).hasAttribute( 'loading' ) ).toBe( true );
		} );
	} );

	test( 'a failed cold load keeps Refresh reachable and says so', async () => {
		// Seeded at zero, so without the catch-path override the user
		// would be looking at "The Trash is empty." with no toolbar and
		// therefore no way to retry.
		mocks.fetchList.mockRejectedValue( new Error( 'offline' ) );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		mount();
		await settle();

		expect( shown() ).toEqual( [ true, true, false ] );
		expect( el( 'table' ).getAttribute( 'empty' ) ).toBe(
			'Could not load the Trash. Try Refresh.',
		);

		// And a successful retry puts the filter copy back.
		mocks.fetchList.mockResolvedValue( { items: [ ITEM ], total: 1 } );
		await refresh();

		expect( el( 'table' ).getAttribute( 'empty' ) ).toBe( NO_MATCH );
		expect(
			( el( 'table' ) as OsTable< RecycleBinItem > ).data,
		).toHaveLength( 1 );
	} );
} );
