/**
 * `<wpd-table>` — smoke tests covering the data-rendering happy path,
 * filter wiring, sticky-column class application, sub-table expansion,
 * and the row-click event guard around no-click descendants.
 *
 * Pixel layout (sticky `left` offsets, sticky-header positioning) is
 * not asserted — jsdom doesn't lay things out, so `offsetWidth` is
 * always 0. The class application is what we cover; the offsets are
 * a runtime-only concern verified manually.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-table';
// eslint-disable-next-line no-duplicate-imports
import type { WpdTable, WpdTableColumn } from './wpd-table';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

interface User extends Record< string, unknown > {
	name: string;
	email: string;
	role: string;
	logins: number;
}

const sampleColumns: WpdTableColumn< User >[] = [
	{ key: 'name', label: 'Name', filter: 'text', sticky: true },
	{ key: 'email', label: 'Email', filter: 'text' },
	{ key: 'role', label: 'Role', filter: 'select' },
	{ key: 'logins', label: 'Logins', align: 'end' },
];

const sampleData: User[] = [
	{ name: 'Alice', email: 'alice@a.com', role: 'admin', logins: 10 },
	{ name: 'Bob', email: 'bob@b.com', role: 'editor', logins: 3 },
	{ name: 'Carol', email: 'carol@c.com', role: 'admin', logins: 7 },
];

describe( '<wpd-table>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders the empty placeholder when there is no data', async () => {
		host.innerHTML = `<wpd-table empty="Nothing here"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' )!;
		const empty = table.shadowRoot!.querySelector( 'tr.empty td' )!;
		expect( empty.textContent?.trim() ).toBe( 'Nothing here' );
	} );

	test( 'renders one tbody row per data entry, in order', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.data = sampleData;
		await tick();

		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows.length ).toBe( 3 );
		expect( rows[ 0 ].textContent ).toContain( 'Alice' );
		expect( rows[ 2 ].textContent ).toContain( 'Carol' );
	} );

	test( 'header labels fall back to the column key', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'foo' }, { key: 'bar', label: 'Baz' } ];
		table.data = [ { foo: 1, bar: 2 } as unknown as User ];
		await tick();
		const ths = table.shadowRoot!.querySelectorAll( 'thead tr:first-child th' );
		expect( ths[ 0 ].textContent?.trim() ).toBe( 'foo' );
		expect( ths[ 1 ].textContent?.trim() ).toBe( 'Baz' );
	} );

	test( 'filter row appears only when at least one column declares a filter', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'a' }, { key: 'b' } ];
		table.data = [];
		await tick();
		expect( table.shadowRoot!.querySelector( 'tr.filter-row' ) ).toBeNull();

		table.columns = [ { key: 'a', filter: 'text' }, { key: 'b' } ];
		await tick();
		expect( table.shadowRoot!.querySelector( 'tr.filter-row' ) ).not.toBeNull();
	} );

	test( 'text filter narrows the rendered rows and emits filter-change', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.data = sampleData;
		await tick();

		const events: Array< { filters: Record< string, string > } > = [];
		table.addEventListener( 'wpd-table-filter-change', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );

		const input = table.shadowRoot!.querySelector(
			'.filter-input',
		) as HTMLInputElement;
		input.value = 'ali';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		await tick();

		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows.length ).toBe( 1 );
		expect( rows[ 0 ].textContent ).toContain( 'Alice' );
		expect( events[ events.length - 1 ].filters.name ).toBe( 'ali' );
	} );

	test( 'select filter populates from unique column values + matches exactly', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.data = sampleData;
		await tick();

		const select = table.shadowRoot!.querySelector(
			'.filter-select',
		) as HTMLSelectElement;
		// "All" + 2 unique roles.
		expect( select.options.length ).toBe( 3 );

		select.value = 'admin';
		select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();

		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows.length ).toBe( 2 );
	} );

	test( 'filterRender columns are not filtered client-side (consumer owns filtering)', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [
			{ key: 'name', label: 'Name' },
			{
				key: 'role',
				label: 'Role',
				filterRender: ( cell ) => {
					if ( ! cell.querySelector( 'input' ) ) {
						cell.appendChild( document.createElement( 'input' ) );
					}
				},
			},
		];
		table.data = sampleData;
		await tick();

		// A filter value that wouldn't match any single role string —
		// this is what a multi-select serializes when ≥2 options are
		// picked. Without the skip, every row would be filtered out.
		table.filters = { role: 'admin,user' };
		await tick();

		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows.length ).toBe( sampleData.length );
	} );

	test( 'sticky-columns adds is-sticky to header + body cells in the band', async () => {
		host.innerHTML = `<wpd-table sticky-columns="2"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [
			{ key: 'a', label: 'A' },
			{ key: 'b', label: 'B' },
			{ key: 'c', label: 'C' },
		];
		table.data = [ { a: 1, b: 2, c: 3 } as unknown as User ];
		await tick();

		const ths = table.shadowRoot!.querySelectorAll( 'thead tr:first-child th' );
		expect( ths[ 0 ].classList.contains( 'is-sticky' ) ).toBe( true );
		expect( ths[ 1 ].classList.contains( 'is-sticky' ) ).toBe( true );
		expect( ths[ 2 ].classList.contains( 'is-sticky' ) ).toBe( false );
		// The second sticky column gets the edge marker (drop-shadow).
		expect( ths[ 1 ].classList.contains( 'is-sticky-edge' ) ).toBe( true );

		const tds = table.shadowRoot!.querySelectorAll( 'tbody tr td' );
		expect( tds[ 0 ].classList.contains( 'is-sticky' ) ).toBe( true );
		expect( tds[ 1 ].classList.contains( 'is-sticky' ) ).toBe( true );
		expect( tds[ 2 ].classList.contains( 'is-sticky' ) ).toBe( false );
	} );

	test( 'subTable: prepends an expander column and toggling reveals a nested wpd-table', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name' } ];
		table.data = [ { name: 'Alice' } as unknown as User ];
		table.subTable = ( row ) => ( {
			columns: [ { key: 'k', label: 'K' } ],
			data: [ { k: `child of ${ row.name }` } ],
		} );
		await tick();

		// Expander column is column 0 — first th has class `col-expander`.
		const firstTh = table.shadowRoot!.querySelector(
			'thead tr:first-child th',
		) as HTMLElement;
		expect( firstTh.classList.contains( 'col-expander' ) ).toBe( true );

		// No sub-table rendered until expanded.
		expect( table.shadowRoot!.querySelector( 'tr.subtable' ) ).toBeNull();

		const events: Array< { row: User; index: number; expanded: boolean } > = [];
		table.addEventListener( 'wpd-table-expand-change', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );

		const expander = table.shadowRoot!.querySelector(
			'tbody .expander',
		) as HTMLButtonElement;
		expander.click();
		await tick();

		expect( events.length ).toBe( 1 );
		expect( events[ 0 ].expanded ).toBe( true );
		const sub = table.shadowRoot!.querySelector( 'tr.subtable' );
		expect( sub ).not.toBeNull();
		expect( sub!.querySelector( 'wpd-table' ) ).not.toBeNull();
	} );

	test( 'row-click event fires for body cells but not for clicks inside data-noclick descendants', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name', filter: 'text' } ];
		table.data = [ { name: 'Alice' } as unknown as User ];
		await tick();

		const events: Array< { row: User; index: number } > = [];
		table.addEventListener( 'wpd-table-row-click', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );

		const cell = table.shadowRoot!.querySelector(
			'tbody tr td',
		) as HTMLTableCellElement;
		cell.click();
		expect( events.length ).toBe( 1 );
		expect( events[ 0 ].index ).toBe( 0 );

		// Filter inputs are marked data-noclick — they must NOT fire row-click.
		const input = table.shadowRoot!.querySelector(
			'.filter-input',
		) as HTMLInputElement;
		input.click();
		expect( events.length ).toBe( 1 );
	} );

	test( 'sortable: clicking a header cycles asc → desc → null and emits sort-change', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [
			{ key: 'name', label: 'Name', sortable: true },
			{ key: 'logins', label: 'Logins', sortable: true },
		];
		table.data = [
			{ name: 'Carol', email: '', role: '', logins: 7 },
			{ name: 'Alice', email: '', role: '', logins: 10 },
			{ name: 'Bob', email: '', role: '', logins: 3 },
		];
		await tick();

		const events: Array< { sort: { key: string; direction: string } | null } > = [];
		table.addEventListener( 'wpd-table-sort-change', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );

		const nameTh = table.shadowRoot!.querySelector(
			'thead tr:first-child th[data-key="name"]',
		) as HTMLElement;

		nameTh.click(); // asc
		await tick();
		expect( events[ events.length - 1 ].sort ).toEqual( { key: 'name', direction: 'asc' } );
		let rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows[ 0 ].textContent ).toContain( 'Alice' );
		expect( rows[ 2 ].textContent ).toContain( 'Carol' );

		nameTh.click(); // desc
		await tick();
		expect( events[ events.length - 1 ].sort ).toEqual( { key: 'name', direction: 'desc' } );
		rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows[ 0 ].textContent ).toContain( 'Carol' );

		nameTh.click(); // null
		await tick();
		expect( events[ events.length - 1 ].sort ).toBeNull();
	} );

	test( 'sortable: numeric columns sort numerically, not lexically', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'logins', label: 'Logins', sortable: true } ];
		table.data = [
			{ name: '', email: '', role: '', logins: 100 },
			{ name: '', email: '', role: '', logins: 9 },
			{ name: '', email: '', role: '', logins: 21 },
		];
		await tick();
		table.sort = { key: 'logins', direction: 'asc' };
		await tick();
		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty) td',
		);
		expect( rows[ 0 ].textContent?.trim() ).toBe( '9' );
		expect( rows[ 1 ].textContent?.trim() ).toBe( '21' );
		expect( rows[ 2 ].textContent?.trim() ).toBe( '100' );
	} );

	test( 'sortable: custom sortValue takes precedence', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		// Sort by string length instead of alphabetical.
		table.columns = [
			{
				key: 'name',
				label: 'Name',
				sortable: true,
				sortValue: ( row ) => ( row.name as string ).length,
			},
		];
		table.data = [
			{ name: 'Carolyn', email: '', role: '', logins: 0 },
			{ name: 'Al', email: '', role: '', logins: 0 },
			{ name: 'Bobby', email: '', role: '', logins: 0 },
		];
		table.sort = { key: 'name', direction: 'asc' };
		await tick();
		const rows = table.shadowRoot!.querySelectorAll(
			'tbody tr:not(.subtable):not(.empty)',
		);
		expect( rows[ 0 ].textContent ).toContain( 'Al' );
		expect( rows[ 1 ].textContent ).toContain( 'Bobby' );
		expect( rows[ 2 ].textContent ).toContain( 'Carolyn' );
	} );

	test( 'selectable=multi: prepends a checkbox column with a select-all in the header', async () => {
		host.innerHTML = `<wpd-table selectable="multi"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name' } ];
		table.data = sampleData;
		await tick();

		const headerCheckbox = table.shadowRoot!.querySelector(
			'thead .select-all-checkbox',
		) as HTMLInputElement;
		expect( headerCheckbox ).not.toBeNull();

		const events: Array< { selection: number[]; rows: User[] } > = [];
		table.addEventListener(
			'wpd-table-selection-change',
			( e: Event ) => events.push( ( e as CustomEvent ).detail ),
		);

		// Click first row checkbox.
		const rowCb = table.shadowRoot!.querySelector(
			'tbody .select-row-checkbox',
		) as HTMLInputElement;
		rowCb.checked = true;
		rowCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();
		expect( events.length ).toBe( 1 );
		expect( events[ 0 ].selection ).toEqual( [ 0 ] );
		expect( table.selectedRows ).toEqual( [ sampleData[ 0 ] ] );

		// Select-all from the header.
		headerCheckbox.checked = true;
		headerCheckbox.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();
		expect( table.selectedRows.length ).toBe( 3 );
	} );

	test( 'toggling a row checkbox does NOT rebuild tbody children', async () => {
		host.innerHTML = `<wpd-table selectable="multi"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name' } ];
		table.data = sampleData;
		await tick();

		const trsBefore = Array.from(
			table.shadowRoot!.querySelectorAll(
				'tbody tr:not(.subtable):not(.empty):not(.skeleton)',
			),
		);
		const firstCb = trsBefore[ 0 ].querySelector(
			'input.select-row-checkbox',
		) as HTMLInputElement;
		// Focus the checkbox so we can verify focus retention.
		firstCb.focus();
		expect( table.shadowRoot!.activeElement ).toBe( firstCb );

		firstCb.checked = true;
		firstCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();

		const trsAfter = Array.from(
			table.shadowRoot!.querySelectorAll(
				'tbody tr:not(.subtable):not(.empty):not(.skeleton)',
			),
		);
		// Same DOM nodes — no rebuild. Identity equality is the
		// load-bearing assertion: a destroy+recreate would pass a
		// `toEqual` check but fail this.
		expect( trsAfter.length ).toBe( trsBefore.length );
		for ( let i = 0; i < trsBefore.length; i++ ) {
			expect( trsAfter[ i ] ).toBe( trsBefore[ i ] );
		}
		// Affected row picked up the class + checkbox state.
		expect( trsAfter[ 0 ].classList.contains( 'is-selected' ) ).toBe( true );
		expect( firstCb.checked ).toBe( true );
		// Focus survived the toggle.
		expect( table.shadowRoot!.activeElement ).toBe( firstCb );
		// Header select-all reflects partial selection.
		const headerCb = table.shadowRoot!.querySelector(
			'thead .select-all-checkbox',
		) as HTMLInputElement;
		expect( headerCb.indeterminate ).toBe( true );
		expect( headerCb.checked ).toBe( false );

		// Deselect by toggling the same checkbox.
		firstCb.checked = false;
		firstCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();
		expect( trsAfter[ 0 ].classList.contains( 'is-selected' ) ).toBe( false );
		expect( headerCb.indeterminate ).toBe( false );
		expect( headerCb.checked ).toBe( false );

		// Select-all from the header still works without rebuilding.
		headerCb.checked = true;
		headerCb.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick();
		const trsAfterAll = Array.from(
			table.shadowRoot!.querySelectorAll(
				'tbody tr:not(.subtable):not(.empty):not(.skeleton)',
			),
		);
		expect( trsAfterAll.length ).toBe( trsBefore.length );
		for ( let i = 0; i < trsBefore.length; i++ ) {
			expect( trsAfterAll[ i ] ).toBe( trsBefore[ i ] );
			expect( trsAfterAll[ i ].classList.contains( 'is-selected' ) ).toBe(
				true,
			);
		}
		expect( headerCb.checked ).toBe( true );
		expect( headerCb.indeterminate ).toBe( false );
	} );

	test( 'selectAll() selects only rows passing the active client-side filter', async () => {
		host.innerHTML = `<wpd-table selectable="multi"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.getRowId = ( row ) => row.email;
		table.data = sampleData;
		// Only the two admins (Alice, Carol) are visible.
		table.filters = { role: 'admin' };
		await tick();

		table.selectAll();
		await tick();

		// Bob is hidden by the filter — a destructive bulk action fed
		// from this selection must not be able to reach him.
		expect( Array.from( table.selection ).sort() ).toEqual( [
			'alice@a.com',
			'carol@c.com',
		] );

		// The header select-all reads checked (not indeterminate):
		// every VISIBLE row is selected, which is what the checkbox
		// claims to control.
		const headerCb = table.shadowRoot!.querySelector(
			'thead .select-all-checkbox',
		) as HTMLInputElement;
		expect( headerCb.checked ).toBe( true );
		expect( headerCb.indeterminate ).toBe( false );
	} );

	test( 'header select-all tri-state tracks visible rows, not the full buffer', async () => {
		host.innerHTML = `<wpd-table selectable="multi"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.getRowId = ( row ) => row.email;
		table.data = sampleData;
		table.select( 'bob@b.com' );
		await tick();

		// Bob (editor) is selected, then a filter hides him. The two
		// visible admins are unselected — the header checkbox must
		// read fully unchecked, not indeterminate, because nothing
		// the user can see is selected.
		table.filters = { role: 'admin' };
		await tick();
		const headerCb = table.shadowRoot!.querySelector(
			'thead .select-all-checkbox',
		) as HTMLInputElement;
		expect( headerCb.checked ).toBe( false );
		expect( headerCb.indeterminate ).toBe( false );
	} );

	test( 'selectable=single: enforces at-most-one selected', async () => {
		host.innerHTML = `<wpd-table selectable="single"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name' } ];
		table.data = sampleData;
		await tick();

		// No header select-all in single mode.
		expect(
			table.shadowRoot!.querySelector( 'thead .select-all-checkbox' ),
		).toBeNull();

		table.select( 0 );
		table.select( 1 );
		expect( Array.from( table.selection ) ).toEqual( [ 1 ] );
	} );

	test( 'getRowId: stable ids survive a data refresh', async () => {
		host.innerHTML = `<wpd-table selectable="multi"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name', label: 'Name' } ];
		table.getRowId = ( row ) => row.email;
		table.data = sampleData;
		table.select( 'alice@a.com' );
		await tick();

		// Reload data with the same email — selection must persist.
		table.data = [ ...sampleData ].reverse();
		await tick();
		expect( table.selectedRows.map( ( r ) => r.email ) ).toEqual( [
			'alice@a.com',
		] );
	} );

	test( 'expand / collapse / expandAll / collapseAll programmatic API', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name' } ];
		table.data = sampleData;
		table.subTable = ( row ) => ( {
			columns: [ { key: 'k' } ],
			data: [ { k: row.name } ],
		} );
		await tick();

		expect( table.isExpanded( 0 ) ).toBe( false );
		table.expand( 1 );
		await tick();
		expect( table.isExpanded( 1 ) ).toBe( true );
		expect(
			table.shadowRoot!.querySelectorAll( 'tr.subtable' ).length,
		).toBe( 1 );

		table.expandAll();
		await tick();
		expect(
			table.shadowRoot!.querySelectorAll( 'tr.subtable' ).length,
		).toBe( 3 );

		table.collapseAll();
		await tick();
		expect(
			table.shadowRoot!.querySelectorAll( 'tr.subtable' ).length,
		).toBe( 0 );
	} );

	test( 'clearFilters() drops every active filter and emits filter-change', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = sampleColumns;
		table.data = sampleData;
		table.filters = { name: 'a', email: 'a' };
		await tick();
		const events: Array< { filters: Record< string, string > } > = [];
		table.addEventListener( 'wpd-table-filter-change', ( e: Event ) => {
			events.push( ( e as CustomEvent ).detail );
		} );
		table.clearFilters();
		await tick();
		expect( events[ events.length - 1 ].filters ).toEqual( {} );
		expect( table.filters ).toEqual( {} );
	} );

	test( 'loading: paints skeleton rows in place of body content', async () => {
		host.innerHTML = `<wpd-table loading loading-rows="3"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name' }, { key: 'email' } ];
		table.data = sampleData;
		await tick();
		const skeletonRows = table.shadowRoot!.querySelectorAll(
			'tbody tr.skeleton',
		);
		expect( skeletonRows.length ).toBe( 3 );
		// Real data rows must NOT appear while loading.
		expect(
			table.shadowRoot!.querySelectorAll(
				'tbody tr:not(.skeleton):not(.empty)',
			).length,
		).toBe( 0 );
	} );

	test( 'empty slot: projects light-DOM children when there is no data', async () => {
		host.innerHTML = `<wpd-table>
			<button slot="empty" id="cta">Add new</button>
		</wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' )!;
		// The slot itself is in shadow DOM; its assignedNodes() returns
		// the projected light-DOM children.
		const slot = table.shadowRoot!.querySelector(
			'tr.empty slot',
		) as HTMLSlotElement;
		expect( slot.name ).toBe( 'empty' );
		const assigned = slot.assignedNodes();
		expect(
			assigned.some(
				( n ) =>
					n instanceof Element && n.id === 'cta',
			),
		).toBe( true );
	} );

	test( 'observes the inner scroll element + host with ResizeObserver and disconnects on teardown', async () => {
		// Stub a counting ResizeObserver so we can assert the lifecycle
		// without depending on jsdom's (absent) layout engine. We
		// observe two boxes: the inner `.scroll` (catches scrollbar-
		// driven width changes that the host doesn't see) and the host
		// itself (catches panel-driven reflows that the inner box
		// doesn't see).
		const observed: Element[] = [];
		const disconnects: number[] = [];
		const original = ( globalThis as unknown as { ResizeObserver?: unknown } ).ResizeObserver;
		class FakeRO {
			observe( el: Element ) {
				observed.push( el );
			}
			disconnect() {
				disconnects.push( 1 );
			}
			unobserve() { /* noop */ }
		}
		( globalThis as unknown as { ResizeObserver: unknown } ).ResizeObserver = FakeRO;
		try {
			host.innerHTML = `<wpd-table sticky-columns="1"></wpd-table>`;
			await tick();
			const table = host.querySelector( 'wpd-table' )!;
			// The inner .scroll element is what catches the most-common
			// stale-offset cause (vertical scrollbar appearing). The
			// host catches panel-driven reflow.
			const scroll = table.shadowRoot!.querySelector( '.scroll' );
			expect( observed ).toContain( scroll );
			expect( observed ).toContain( table );
			table.remove();
			expect( disconnects.length ).toBe( 1 );
		} finally {
			( globalThis as unknown as { ResizeObserver?: unknown } ).ResizeObserver = original;
		}
	} );

	test( 'toggling the `loading` attribute live re-paints the body without a data reassignment', async () => {
		// Regression: attribute changes on a wpd-table used to bypass
		// the imperative paint pipeline because the base
		// Component.attributeChangedCallback called _scheduleRender
		// directly instead of routing through requestUpdate. Result:
		// flipping `loading` re-rendered the templated skeleton but
		// never rebuilt the body, so the skeleton rows never appeared.
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'name' } ];
		table.data = sampleData;
		await tick();
		expect(
			table.shadowRoot!.querySelectorAll( 'tbody tr.skeleton' ).length,
		).toBe( 0 );

		table.setAttribute( 'loading', '' );
		await tick();
		expect(
			table.shadowRoot!.querySelectorAll( 'tbody tr.skeleton' ).length,
		).toBeGreaterThan( 0 );

		table.removeAttribute( 'loading' );
		await tick();
		expect(
			table.shadowRoot!.querySelectorAll( 'tbody tr.skeleton' ).length,
		).toBe( 0 );
		expect(
			table.shadowRoot!.querySelectorAll(
				'tbody tr:not(.skeleton):not(.empty)',
			).length,
		).toBe( sampleData.length );
	} );

	test( 'recomputeLayout() is callable as a public escape hatch', async () => {
		host.innerHTML = `<wpd-table sticky-columns="1"></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [ { key: 'a' }, { key: 'b' } ];
		table.data = [ { a: 1, b: 2 } as unknown as User ];
		await tick();
		// Should not throw, and should not change anything observable
		// in jsdom (no layout). It's the existence + idempotency that
		// matter — pixel correctness is verified manually.
		expect( () => table.recomputeLayout() ).not.toThrow();
		expect( () => table.recomputeLayout() ).not.toThrow();
	} );

	test( 'custom render() is invoked per cell and its return is mounted', async () => {
		host.innerHTML = `<wpd-table></wpd-table>`;
		await tick();
		const table = host.querySelector( 'wpd-table' ) as WpdTable< User >;
		table.columns = [
			{
				key: 'name',
				label: 'Name',
				render: ( v ) => `>> ${ String( v ) }`,
			},
		];
		table.data = [ { name: 'Alice' } as unknown as User ];
		await tick();
		const cell = table.shadowRoot!.querySelector( 'tbody tr td' );
		expect( cell?.textContent?.trim() ).toBe( '>> Alice' );
	} );
} );
