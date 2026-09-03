/**
 * `<os-table>` — data-driven, DX-first table.
 *
 * The pitch is "give it data + columns, get a nice table". Everything
 * else is opt-in via attributes or a single column descriptor:
 *
 * ```ts
 * const table = document.querySelector< OsTable< User > >( '#users' )!;
 * table.columns = [
 *     { key: 'name',   label: 'Name',   filter: 'text',   sortable: true, sticky: true },
 *     { key: 'email',  label: 'Email',  filter: 'text',   sortable: true },
 *     { key: 'role',   label: 'Role',   filter: 'select' },
 *     { key: 'logins', label: 'Logins', align: 'end',     sortable: true },
 * ];
 * table.data = users;
 * table.subTable = ( row ) => row.history?.length
 *     ? { columns: historyCols, data: row.history }
 *     : null;
 * ```
 *
 * ## Features at a glance
 *
 *   - **Per-column filters.** `column.filter = 'text' | 'select'`
 *     (or `true`, default text). Inputs persist across re-paints so
 *     typing never loses focus.
 *   - **Click-to-sort.** `column.sortable = true` makes the header
 *     cycle asc → desc → unsorted. Provide `column.sortValue` for
 *     custom sort keys (e.g. parse a date out of a string).
 *   - **Multi-row selection.** `selectable="single"` or
 *     `selectable="multi"` auto-prepends a checkbox column. Read /
 *     write the chosen row ids through `selection`; supply
 *     `getRowId( row, i )` for stable ids across data refreshes.
 *   - **Sticky columns.** `sticky-columns="N"` pins the first N
 *     columns. Widths are measured after layout, so variable-width
 *     columns work — RTL via `inset-inline-start`.
 *   - **Sticky header.** `sticky-header` pins the header (plus the
 *     filter row, if any) to the top of the scroll container.
 *   - **Sub-tables.** `subTable( row, index )` returns a
 *     `{ columns, data }` or any `Node` / template. An expander
 *     column is auto-prepended; sub-tables nest infinitely.
 *   - **Custom cells.** `column.render( value, row, index )` returns
 *     a string, `Node`, or `html\`\`` template.
 *   - **Loading state.** `loading` paints shimmering skeleton rows.
 *   - **Empty state.** `<slot name="empty">` lets the host project a
 *     CTA; the `empty` attribute is the text fallback.
 *   - **Stacked layout.** `stacked` lays every row out as a card —
 *     the first column as its title, the others as labelled lines,
 *     a label-less column as a row of actions — for a phone or any
 *     width a table cannot fit. Same `columns`, same `data`, same
 *     selection and events; no header, no sticky columns, nothing to
 *     scroll sideways. `column.stack` overrides a column's role.
 *
 * ## Programmatic API surface
 *
 * Every interactive piece has a method-form so callers don't poke at
 * the DOM:
 *
 *   - `expand(i)`, `collapse(i)`, `expandAll()`, `collapseAll()`,
 *     `isExpanded(i)`, `expanded` (getter / setter for the full set).
 *   - `clearFilters()`, `filters` (read or pre-seed).
 *   - `sort` (read or set), `clearSort()`.
 *   - `select(id)`, `deselect(id)`, `selectAll()`, `clearSelection()`,
 *     `selection`, `selectedRows`, `getRowId`.
 *   - `scrollToRow(i)`.
 *
 * ## Why imperative paint
 *
 * The `html\`\`` template renderer parses every nested template via
 * `template.innerHTML`, which applies HTML's content-model rules — so
 * a sub-template with `<tr>`/`<td>`/`<col>` gets hoisted out of its
 * expected parent. We render an empty table skeleton via the template
 * tag, then paint headers / rows / cells imperatively. Filter inputs
 * are kept across paints so typing into one doesn't lose focus on
 * every keystroke.
 *
 * ## Events
 *
 *   - `os-table-filter-change` — `{ filters }` on filter input change.
 *   - `os-table-sort-change` — `{ sort }` (or `{ sort: null }`).
 *   - `os-table-selection-change` — `{ selection, rows }`.
 *   - `os-table-row-click` — `{ row, index, originalEvent }` (skips
 *     clicks on `data-noclick` descendants).
 *   - `os-table-expand-change` — `{ row, index, expanded }`.
 */

import { Component, defineComponent, html, render as renderTemplate, type TemplateResult } from '../../core';
import { styles } from './os-table.styles';

/**
 * Per-column descriptor. The bare minimum is `{ key }`; everything
 * else is optional. Generic over the row type so `render` and
 * `sortValue` get strong types when consumers type the table.
 */
/** One option in a column's filter dropdown when `filterOptions` is set. */
export interface OsTableColumnFilterOption {
	/** Value emitted in `os-table-filter-change.detail.filters[col.key]`. */
	value: string;
	/** Visible label in the dropdown. */
	label: string;
}

export interface OsTableColumn< T = Record< string, unknown > > {
	/** Property on the row to read. Also used as the column id. */
	key: string;
	/** Header text. Defaults to `key`. */
	label?: string;
	/**
	 * Built-in filter. `true` and `'text'` give a substring match;
	 * `'select'` builds a dropdown from the unique column values.
	 */
	filter?: boolean | 'text' | 'select';
	/**
	 * Explicit option list for the filter dropdown — overrides the
	 * default "unique values pulled from the visible rows" behaviour.
	 * Use this when the column renders an opaque value (e.g. an
	 * author id whose label is fetched separately) or when the
	 * server is the filter authority (e.g. a server-paginated table
	 * that needs the dropdown to list ALL possible values, not just
	 * the ones on the current page).
	 *
	 * Implies `filter: 'select'` — you do NOT also need to set
	 * `filter` when `filterOptions` is present.
	 */
	filterOptions?: OsTableColumnFilterOption[];
	/**
	 * Custom filter renderer. When set, the column owns the entire
	 * filter cell — the table calls this once per filter-row paint
	 * to mount the control inside the `<th>` host (the same host is
	 * reused across paints; the callback may early-return when its
	 * control is already mounted). Use for richer filters than the
	 * built-in `<input>` / `<select>` — e.g. multi-select chips, a
	 * date-range picker, a slider.
	 *
	 * The `ctx.value` reflects the column's current filter value
	 * (whatever was last passed to `setValue`); call `ctx.setValue`
	 * to update it. The same `os-table-filter-change` event fires
	 * regardless of which filter shape produced the change.
	 *
	 * `filterRender` columns are NOT filtered client-side — their
	 * value is opaque to the table (could be a comma-joined id
	 * list, JSON, anything). The consumer owns filtering: typically
	 * by listening to `os-table-filter-change` and re-querying the
	 * server, or by reassigning `data` with already-filtered rows.
	 */
	filterRender?: (
		host: HTMLTableCellElement,
		ctx: {
			value: string;
			setValue: ( next: string ) => void;
			col: OsTableColumn< T >;
		},
	) => void;
	/** Make the header click-to-sort (asc → desc → unsorted cycle). */
	sortable?: boolean;
	/**
	 * Custom value extractor for sorts. Defaults to `row[key]`. Use
	 * for shaped sorts — e.g. parsing a date from a display string,
	 * or sorting by a computed score.
	 */
	sortValue?: ( row: T, value: unknown ) => unknown;
	/** Pin this column when sticky-columns covers its index. */
	sticky?: boolean;
	/** CSS text-align — `'start' | 'center' | 'end'`. */
	align?: 'start' | 'center' | 'end';
	/** Fixed CSS width — passed straight to `<col style="width">`. */
	width?: string;
	/**
	 * Minimum CSS width — applied to body cells (`<td>`) of this
	 * column so the column refuses to shrink below the value when
	 * the table is squeezed horizontally. Mostly useful for cells
	 * whose contents wrap (chip rows, multi-line previews) where a
	 * narrow column would force every chip onto its own line.
	 */
	minWidth?: string;
	/** Custom cell renderer. Return a string, Node, or `html\`\``. */
	render?: ( value: unknown, row: T, index: number ) => string | Node | TemplateResult;
	/**
	 * The column's role when the table is `stacked` (a card per
	 * row). Defaults: the first data column is the `title`, a column
	 * with no label is the `actions` row, every other column is a
	 * `meta` line captioned with its label. `hidden` leaves the
	 * column out of the card without removing it from `columns`, so
	 * the desk's table and the phone's cards share one descriptor
	 * list.
	 */
	stack?: OsTableStackRole;
}

/** How a column presents inside a stacked row — see {@link OsTableColumn.stack}. */
export type OsTableStackRole = 'title' | 'meta' | 'actions' | 'hidden';

/**
 * Sub-table descriptor — independent of the parent's row type so a
 * sub-table can have a totally different shape than its container
 * (the typical case: an Orders table with a per-order Items sub-table).
 */
export type OsTableSubTableResult =
	| null
	| undefined
	| Node
	| TemplateResult
	| {
		columns: OsTableColumn< Record< string, unknown > >[];
		data: Record< string, unknown >[];
		/** Optional — make the nested sub-table itself expandable. */
		subTable?: OsTableSubTableFn;
	};

export type OsTableSubTableFn< T = Record< string, unknown > > = (
	row: T,
	index: number,
) => OsTableSubTableResult;

/** Filter map — column key → input value. Empty string means no filter. */
export type OsTableFilters = Record< string, string >;

/** Active sort. `null` is "no sort applied". */
export type OsTableSort =
	| { key: string; direction: 'asc' | 'desc' }
	| null;

/** Stable id for a row — defaults to its index. Override via `getRowId`. */
export type OsTableRowId = string | number;

export type OsTableGetRowId< T = Record< string, unknown > > = (
	row: T,
	index: number,
) => OsTableRowId;

const EXPANDER_KEY = '__wpd_expander__';
const SELECT_KEY = '__wpd_select__';

interface FilterInputCache {
	/** The wrapper `<th>` cell — kept across paints. */
	th: HTMLTableCellElement;
	/** The filter `<input>` or `<select>`. `null` for custom-render columns. */
	control: HTMLInputElement | HTMLSelectElement | null;
	/** Last set of options written into a select (sorted, joined). */
	optionsKey: string;
	/** Filter kind currently mounted — re-create if it changes. */
	kind: 'text' | 'select' | 'custom' | 'none';
}

export class OsTable< T extends Record< string, unknown > = Record< string, unknown > > extends Component {
	static props = [
		'stickyColumns',
		'stickyHeader',
		'striped',
		'hover',
		'compact',
		'bordered',
		'empty',
		'loading',
		'loadingRows',
		'selectable',
		'stacked',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Table',
		summary:
			'Data-driven table. Assign `columns` + `data` and you get a styled table with optional per-column filters, click-to-sort, multi-row selection, sticky columns/header, sub-tables, custom cell renderers, loading skeleton, and a slottable empty state.',
		status: 'stable',
		props: [
			{
				name: 'sticky-columns',
				type: 'integer',
				description:
					'Pin the first N columns to the inline-start edge. Widths are measured after layout, so variable-width columns work. The auto-injected expander (subTable) and select (selectable) columns count toward N.',
			},
			{
				name: 'sticky-header',
				type: 'boolean',
				description:
					'Pin the header (and filter row) to the top. Requires a scrolling parent or `--os-ui-table-max-height` — the component warns once if it detects sticky-header on a non-scrolling container.',
			},
			{ name: 'striped', type: 'boolean', description: 'Zebra rows.' },
			{ name: 'hover', type: 'boolean', description: 'Highlight rows on hover.' },
			{ name: 'compact', type: 'boolean', description: 'Tighter padding + smaller font.' },
			{ name: 'bordered', type: 'boolean', description: 'Vertical cell borders.' },
			{
				name: 'empty',
				type: 'string',
				description:
					'Fallback text shown when there are no rows. For richer empty states, project light-DOM content into the `empty` slot.',
			},
			{
				name: 'loading',
				type: 'boolean',
				description:
					'Paint shimmering skeleton rows in place of body content. Filters / sort headers stay live.',
			},
			{
				name: 'loading-rows',
				type: 'integer',
				description: 'Number of skeleton rows when loading. Default 5.',
			},
			{
				name: 'selectable',
				type: '"single" | "multi"',
				description:
					'Auto-prepend a checkbox column. `multi` puts a select-all checkbox in the header; `single` enforces at-most-one selected.',
			},
			{
				name: 'stacked',
				type: 'boolean',
				description:
					'Lay every row out as a card instead of a table row: the first column is the title, the others are labelled lines, a label-less column is the actions row (`column.stack` overrides the role per column). No header, no sticky columns, nothing scrolls sideways — the layout for a phone, or any width the columns cannot fit. Selection, sub-tables, row clicks and every event work unchanged.',
			},
		],
		events: [
			{ name: 'os-table-filter-change', description: 'Filter input changed.' },
			{ name: 'os-table-sort-change', description: 'Header click cycled the sort.' },
			{ name: 'os-table-selection-change', description: 'Selection set changed.' },
			{ name: 'os-table-row-click', description: 'Body row clicked (skips data-noclick descendants).' },
			{ name: 'os-table-expand-change', description: 'Sub-table toggled.' },
		],
		slots: [
			{ name: 'empty', description: 'Custom empty-state content (CTA, illustration, etc.).' },
		],
		cssProps: [
			{ name: '--os-ui-table-bg' },
			{ name: '--os-ui-table-border' },
			{ name: '--os-ui-table-column-border' },
			{ name: '--os-ui-table-header-bg' },
			{ name: '--os-ui-table-row-hover' },
			{ name: '--os-ui-table-stripe' },
			{ name: '--os-ui-table-cell-padding' },
			{ name: '--os-ui-table-font-size' },
			{ name: '--os-ui-table-max-height' },
			{ name: '--os-ui-table-skeleton-color' },
		],
		/*
		 * `data` and `columns` are properties, not attributes, so the
		 * markup alone renders an empty frame — which is what this
		 * example was before `exampleInit` existed.
		 */
		example: html`<os-table striped hover></os-table>`,
		exampleInit: ( root: HTMLElement ) => {
			const table = root.querySelector( 'os-table' );
			if ( ! table ) {
				return;
			}
			const t = table as OsTable< Record< string, unknown > >;
			t.columns = [
				{ key: 'name', label: 'Name' },
				{ key: 'kind', label: 'Kind', filter: 'select' },
				{ key: 'size', label: 'Size', align: 'end' },
			];
			t.data = [
				{ name: 'wp-config.php', kind: 'PHP', size: '4 KB' },
				{ name: 'style.css', kind: 'CSS', size: '61 KB' },
				{ name: 'header.php', kind: 'PHP', size: '3 KB' },
				{ name: 'screenshot.png', kind: 'Image', size: '210 KB' },
			];
		},
	} as const;

	private _data: T[] = [];
	private _columns: OsTableColumn< T >[] = [];
	private _filters: OsTableFilters = {};
	private _expanded = new Set< number >();
	private _subTable: OsTableSubTableFn< T > | null = null;

	private _sort: OsTableSort = null;
	private _selection = new Set< OsTableRowId >();
	private _getRowId: OsTableGetRowId< T > = ( _row, index ) => index;

	/** Filter input cells, keyed by column key, kept across paints. */
	private _filterCache = new Map< string, FilterInputCache >();

	private _paintScheduled = false;
	/** `stacked` as read at the start of the current paint. */
	private _stacked = false;
	private _stickyHeaderWarned = false;
	private _stickyRaceWarned = false;
	private _resizeObserver: ResizeObserver | null = null;
	private _stickyMicroScheduled = false;
	private _stickyRafHandle: number | null = null;

	// ------------------------------------------------------------------
	// Public properties — set from JS (use `.data=${...}` in templates).
	// ------------------------------------------------------------------

	/** The row buffer. Reassigning replaces (and clears expansion state). */
	get data(): readonly T[] {
		return this._data;
	}
	set data( next: readonly T[] | null | undefined ) {
		this._data = Array.isArray( next ) ? next.slice() : [];
		this._expanded.clear();
		// Selection is intentionally NOT cleared — when callers supply a
		// stable `getRowId`, selection survives data refreshes (the most
		// useful behavior). Stale ids are filtered out at paint time.
		this._schedulePaint();
	}

	/** Column descriptors. See {@link OsTableColumn}. */
	get columns(): readonly OsTableColumn< T >[] {
		return this._columns;
	}
	set columns( next: readonly OsTableColumn< T >[] | null | undefined ) {
		this._columns = Array.isArray( next ) ? next.slice() : [];
		// Drop filters / sort / cached inputs whose column went away.
		const keys = new Set( this._columns.map( ( c ) => c.key ) );
		for ( const k of Object.keys( this._filters ) ) {
			if ( ! keys.has( k ) ) {
				delete this._filters[ k ];
			}
		}
		for ( const k of Array.from( this._filterCache.keys() ) ) {
			if ( ! keys.has( k ) ) {
				this._filterCache.delete( k );
			}
		}
		if ( this._sort && ! keys.has( this._sort.key ) ) {
			this._sort = null;
		}
		this._schedulePaint();
	}

	/** Read or replace the current filter map. */
	get filters(): Readonly< OsTableFilters > {
		return { ...this._filters };
	}
	set filters( next: OsTableFilters | null | undefined ) {
		this._filters = next ? { ...next } : {};
		this._schedulePaint();
	}

	/** Read or set the active sort. `null` clears it. */
	get sort(): OsTableSort {
		return this._sort ? { ...this._sort } : null;
	}
	set sort( next: OsTableSort | undefined ) {
		this._sort = next ? { ...next } : null;
		this._schedulePaint();
	}

	/** Read or replace the selection (set of row ids). */
	get selection(): ReadonlySet< OsTableRowId > {
		return new Set( this._selection );
	}
	set selection( next: Iterable< OsTableRowId > | null | undefined ) {
		this._selection = new Set( next ?? [] );
		this._schedulePaint();
	}

	/** The currently-selected rows (resolved from `selection` + `data`). */
	get selectedRows(): T[] {
		const out: T[] = [];
		this._data.forEach( ( row, i ) => {
			if ( this._selection.has( this._getRowId( row, i ) ) ) {
				out.push( row );
			}
		} );
		return out;
	}

	/**
	 * The rows currently visible — i.e. passing the active client-side
	 * filters, in data order. This is the row set `selectAll()` and
	 * the header select-all tri-state operate on.
	 *
	 * Destructive bulk consumers should resolve `selection` against
	 * THIS list rather than `data`: selection deliberately survives
	 * `data` reassignment, and a data-driven change (a realtime
	 * refresh editing a row so it no longer matches an active filter)
	 * can hide a selected row without any filter event firing. Rows
	 * the user cannot see must never be swept into a destructive
	 * action. See `collectSelected()` in apps/trash/trash.os.ts for
	 * the canonical consumer.
	 */
	get visibleRows(): T[] {
		return this._filteredRows().map( ( entry ) => entry.row );
	}

	/** Stable row-id extractor. Default is row index. */
	get getRowId(): OsTableGetRowId< T > {
		return this._getRowId;
	}
	set getRowId( fn: OsTableGetRowId< T > | null | undefined ) {
		this._getRowId = typeof fn === 'function' ? fn : ( ( _r, i ) => i );
		this._schedulePaint();
	}

	/**
	 * Sub-table accessor. Return `null` (or omit) for rows with no
	 * children. Return `{ columns, data }` to render a nested
	 * `<os-table>` inline; or return any `Node` / `html\`\`` template
	 * for fully custom expanded content.
	 */
	get subTable(): OsTableSubTableFn< T > | null {
		return this._subTable;
	}
	set subTable( fn: OsTableSubTableFn< T > | null | undefined ) {
		this._subTable = typeof fn === 'function' ? fn : null;
		this._expanded.clear();
		this._schedulePaint();
	}

	/** Read or replace the expansion set (row indices that are open). */
	get expanded(): ReadonlySet< number > {
		return new Set( this._expanded );
	}
	set expanded( next: Iterable< number > | null | undefined ) {
		this._expanded = new Set( next ?? [] );
		this._schedulePaint();
	}

	// ------------------------------------------------------------------
	// Programmatic methods
	// ------------------------------------------------------------------

	/** Open a row's sub-table by index. No-op if the index is out of range. */
	expand( index: number ): void {
		if ( index < 0 || index >= this._data.length ) {
			return;
		}
		if ( this._expanded.has( index ) ) {
			return;
		}
		this._expanded.add( index );
		this.emit( 'os-table-expand-change', {
			row: this._data[ index ],
			index,
			expanded: true,
		} );
		this._schedulePaint();
	}

	/** Close a row's sub-table by index. No-op if it wasn't open. */
	collapse( index: number ): void {
		if ( ! this._expanded.has( index ) ) {
			return;
		}
		this._expanded.delete( index );
		this.emit( 'os-table-expand-change', {
			row: this._data[ index ],
			index,
			expanded: false,
		} );
		this._schedulePaint();
	}

	/** Open every row that has children. */
	expandAll(): void {
		if ( ! this._subTable ) {
			return;
		}
		let changed = false;
		for ( let i = 0; i < this._data.length; i++ ) {
			if ( ! this._subTable( this._data[ i ], i ) ) {
				continue;
			}
			if ( ! this._expanded.has( i ) ) {
				this._expanded.add( i );
				changed = true;
			}
		}
		if ( changed ) {
			this._schedulePaint();
		}
	}

	/** Close every open row. */
	collapseAll(): void {
		if ( this._expanded.size === 0 ) {
			return;
		}
		this._expanded.clear();
		this._schedulePaint();
	}

	isExpanded( index: number ): boolean {
		return this._expanded.has( index );
	}

	/** Drop every active filter and emit `os-table-filter-change`. */
	clearFilters(): void {
		if ( Object.keys( this._filters ).length === 0 ) {
			return;
		}
		this._filters = {};
		this.emit( 'os-table-filter-change', { filters: {} } );
		this._schedulePaint();
	}

	/** Drop the active sort and emit `os-table-sort-change`. */
	clearSort(): void {
		if ( this._sort === null ) {
			return;
		}
		this._sort = null;
		this.emit( 'os-table-sort-change', { sort: null } );
		this._schedulePaint();
	}

	/**
	 * Add a row id to the selection. Emits `os-table-selection-change`.
	 *
	 * Selection mutators (`select` / `deselect` / `selectAll` /
	 * `clearSelection`) update the affected row in place via
	 * {@link _syncSelectionDom} rather than re-rendering the whole
	 * tbody — a rebuild would tear down the focused checkbox and
	 * (because scroll-anchoring abandons a momentarily empty container)
	 * could snap scroll back to the top.
	 */
	select( id: OsTableRowId ): void {
		if ( this._selection.has( id ) ) {
			return;
		}
		const mode = this._readSelectable();
		const previouslySelected: OsTableRowId[] =
			mode === 'single' ? Array.from( this._selection ) : [];
		if ( mode === 'single' ) {
			this._selection.clear();
		}
		this._selection.add( id );
		this._emitSelectionChange();
		this._syncSelectionDom( [ id, ...previouslySelected ] );
	}

	/** Remove a row id from the selection. */
	deselect( id: OsTableRowId ): void {
		if ( ! this._selection.delete( id ) ) {
			return;
		}
		this._emitSelectionChange();
		this._syncSelectionDom( [ id ] );
	}

	/** Select every visible row — the rows passing the active client-side filters (multi-mode only). */
	selectAll(): void {
		if ( this._readSelectable() !== 'multi' ) {
			return;
		}
		// Only the rows the user can see. Selecting the full `_data`
		// buffer would let the header checkbox silently sweep rows a
		// client-side column filter is hiding — and a destructive bulk
		// action would then hit rows the user never saw. Tables without
		// client-side filters are unaffected (`_filteredRows()` returns
		// the full buffer).
		for ( const { row, index } of this._filteredRows() ) {
			this._selection.add( this._getRowId( row, index ) );
		}
		this._emitSelectionChange();
		this._syncSelectionDom( 'all' );
	}

	/** Empty the selection. */
	clearSelection(): void {
		if ( this._selection.size === 0 ) {
			return;
		}
		this._selection.clear();
		this._emitSelectionChange();
		this._syncSelectionDom( 'all' );
	}

	/**
	 * Apply a selection change to the existing tbody DOM without
	 * rebuilding it. Updates each affected row's `is-selected` class
	 * and `select-row-checkbox` `checked` state, then re-syncs the
	 * header select-all checkbox (checked / indeterminate / empty).
	 *
	 * @param ids `'all'` to walk every row, or an iterable of row ids
	 *            whose rows need updating. Unknown ids are silently
	 *            skipped (row may not be in the current filter/page).
	 */
	private _syncSelectionDom(
		ids: 'all' | Iterable< OsTableRowId >,
	): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const tbody = root.querySelector( 'tbody' );
		if ( ! tbody ) {
			return;
		}
		// String-keyed lookup matches `tr.dataset.rowId`; the row's
		// original id (number | string) is recovered when we compare
		// against `_selection`.
		let needle: Set< string > | null = null;
		if ( ids !== 'all' ) {
			needle = new Set< string >();
			for ( const id of ids ) {
				needle.add( String( id ) );
			}
		}
		const rows = tbody.querySelectorAll< HTMLTableRowElement >(
			'tr[data-row-id]',
		);
		for ( const tr of rows ) {
			const rowIdStr = tr.dataset.rowId;
			if ( rowIdStr === undefined ) {
				continue;
			}
			if ( needle && ! needle.has( rowIdStr ) ) {
				continue;
			}
			const idx = Number( tr.dataset.rowIndex );
			if ( ! Number.isFinite( idx ) ) {
				continue;
			}
			const row = this._data[ idx ];
			if ( row === undefined ) {
				continue;
			}
			const id = this._getRowId( row, idx );
			const isSelected = this._selection.has( id );
			tr.classList.toggle( 'is-selected', isSelected );
			const cb = tr.querySelector< HTMLInputElement >(
				'input.select-row-checkbox',
			);
			if ( cb && cb.checked !== isSelected ) {
				cb.checked = isSelected;
			}
		}
		// Re-sync the header select-all so the indeterminate / checked
		// tri-state matches the new selection size.
		const headerCb = root.querySelector< HTMLInputElement >(
			'thead .select-all-checkbox',
		);
		if ( headerCb ) {
			const { total, selected } = this._visibleSelectionStats();
			headerCb.checked = total > 0 && selected === total;
			headerCb.indeterminate = selected > 0 && selected < total;
		}
	}

	/** Scroll the (filtered) row at `index` into view inside the table's scroll container. */
	scrollToRow( index: number ): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const rows = root.querySelectorAll< HTMLElement >(
			'tbody tr:not(.subtable):not(.empty):not(.skeleton)',
		);
		const row = rows[ index ];
		if ( row ) {
			row.scrollIntoView( { block: 'nearest', inline: 'nearest' } );
		}
	}

	connectedCallback(): void {
		super.connectedCallback();
		this._schedulePaint();
	}

	disconnectedCallback(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
		if ( this._stickyRafHandle !== null && typeof cancelAnimationFrame !== 'undefined' ) {
			cancelAnimationFrame( this._stickyRafHandle );
			this._stickyRafHandle = null;
		}
	}

	/**
	 * Force a sticky-offsets recompute. Public escape hatch for the
	 * rare case where layout settles after every internal hook has
	 * fired — e.g. an out-of-band font swap or a JS-driven width
	 * change on an ancestor that doesn't bubble through ResizeObserver.
	 *
	 * Usually you don't need this: the component schedules recomputes
	 * on a microtask + animation frame after every paint, and a
	 * ResizeObserver on the inner scroll element catches geometry
	 * changes thereafter. Reach for `recomputeLayout()` only if you've
	 * confirmed that all of those pathways missed your case.
	 */
	recomputeLayout(): void {
		this._applyStickyOffsets();
		this._measureHeaderHeight();
	}

	// ------------------------------------------------------------------
	// Skeleton + paint pipeline
	// ------------------------------------------------------------------

	protected render(): TemplateResult {
		return html`
			<div class="scroll" part="scroll">
				<table part="table">
					<colgroup></colgroup>
					<thead></thead>
					<tbody></tbody>
				</table>
			</div>
		`;
	}

	protected requestUpdate(): void {
		super.requestUpdate();
		this._schedulePaint();
	}

	private _schedulePaint(): void {
		if ( this._paintScheduled || ! this.isConnected ) {
			return;
		}
		this._paintScheduled = true;
		queueMicrotask( () => {
			this._paintScheduled = false;
			if ( ! this.isConnected ) {
				return;
			}
			this._paint();
		} );
	}

	private _paint(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		if ( ! root.querySelector( 'tbody' ) ) {
			renderTemplate( this.render(), root );
		}

		const colgroup = root.querySelector( 'colgroup' );
		const thead = root.querySelector( 'thead' );
		const tbody = root.querySelector( 'tbody' );
		if ( ! colgroup || ! thead || ! tbody ) {
			return;
		}

		const cols = this._effectiveColumns();
		this._stacked = this.hasAttribute( 'stacked' );
		const stickyN = this._readStickyColumns();
		this._lastStickyIndex = this._computeLastStickyIndex( cols, stickyN );

		this._paintColgroup( colgroup, cols );
		this._paintHead( thead, cols, stickyN );
		this._paintBody( tbody, cols, stickyN );

		// Synchronous pass — fixes the common case where layout is
		// already settled at paint time. The microtask + rAF passes
		// scheduled below catch the cases where it isn't (mid-
		// transition mounts, font swaps, async style applies).
		this._applyStickyOffsets();
		this._measureHeaderHeight();
		this._scheduleStickyOffsets();
		this._maybeWarnStickyHeader();
		this._maybeWarnLoadingDesync( tbody );
		this._ensureResizeObserver();
	}

	private _loadingDesyncWarned = false;
	/**
	 * Diagnostic for the "I set `loading` but the skeleton never
	 * appeared" footgun. If we get here with the attribute on but no
	 * `.skeleton` rows in `tbody`, something between attribute set and
	 * paint went off the rails — historically this happened when the
	 * base `Component.attributeChangedCallback` called `_scheduleRender`
	 * directly, bypassing our `requestUpdate` override. Same pattern as
	 * the sticky-columns 0px tripwire: should never fire, but if it
	 * does, names the bug instead of leaving the dev guessing.
	 */
	private _maybeWarnLoadingDesync( tbody: Element ): void {
		if ( this._loadingDesyncWarned ) {
			return;
		}
		if ( ! this.hasAttribute( 'loading' ) ) {
			return;
		}
		if ( tbody.querySelector( 'tr.skeleton' ) ) {
			return;
		}
		this._loadingDesyncWarned = true;
		// eslint-disable-next-line no-console
		console.warn(
			'[os-table] `loading` attribute is set but no skeleton rows ' +
				'rendered. Either attributeChangedCallback didn\'t route through ' +
				'requestUpdate (framework regression), or `loading` was set after ' +
				'the most recent paint and no follow-up trigger ran. Toggling ' +
				'`data` will force a paint as a workaround.',
		);
	}

	/**
	 * Belt-and-braces sticky-offset scheduling.
	 *
	 *   - Microtask: cheap, fires after the current task drains. Fixes
	 *     mounts where the synchronous read in `_paint` happened before
	 *     a sibling style applied.
	 *   - rAF: fires before the next paint. Catches "layout settles
	 *     after a queued style mutation" races — the most common cause
	 *     of "col 1 ended up at inset-inline-start: 0px".
	 *
	 * Both reduce to a no-op when nothing changed. The cost is two
	 * extra DOM reads per paint; the win is the bug class disappears.
	 */
	private _scheduleStickyOffsets(): void {
		if ( ! this._stickyMicroScheduled ) {
			this._stickyMicroScheduled = true;
			queueMicrotask( () => {
				this._stickyMicroScheduled = false;
				if ( this.isConnected ) {
					this._applyStickyOffsets();
				}
			} );
		}
		if (
			this._stickyRafHandle === null &&
			typeof requestAnimationFrame !== 'undefined'
		) {
			this._stickyRafHandle = requestAnimationFrame( () => {
				this._stickyRafHandle = null;
				if ( this.isConnected ) {
					this._applyStickyOffsets();
					this._measureHeaderHeight();
				}
			} );
		}
	}

	/**
	 * Wire a `ResizeObserver` on the inner `.scroll` element (NOT the
	 * host). Why: the host's outer width is often pinned by its parent
	 * panel — a vertical scrollbar appearing inside the table changes
	 * the inner scroll-area width by ~15px without changing the host
	 * size. Observing the host would miss that reflow and leave sticky
	 * offsets stale.
	 *
	 * Idempotent — runs once after the first paint produces a real
	 * `.scroll` element. Disconnect happens in `disconnectedCallback`.
	 */
	private _ensureResizeObserver(): void {
		if ( this._resizeObserver ) {
			return;
		}
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const scroll = this.shadowRoot?.querySelector(
			'.scroll',
		) as HTMLElement | null;
		if ( ! scroll ) {
			return;
		}
		this._resizeObserver = new ResizeObserver( () => {
			if ( ! this.isConnected ) {
				return;
			}
			this._applyStickyOffsets();
			this._measureHeaderHeight();
			// A previously-zero scroll container that just became
			// visible may now actually overflow — re-arm the warning
			// so users get the heads-up the first time scroll context
			// appears without a max-height.
			this._stickyHeaderWarned = false;
			this._maybeWarnStickyHeader();
		} );
		this._resizeObserver.observe( scroll );
		// Also observe the host so panel-driven width changes (parent
		// flex reflow, container query crossing) fire the callback.
		// Multiple observe() calls on the same RO are allowed.
		this._resizeObserver.observe( this );
	}

	private _paintColgroup(
		colgroup: Element,
		cols: OsTableColumn< T >[],
	): void {
		const out: HTMLElement[] = [];
		for ( const c of cols ) {
			const col = document.createElement( 'col' );
			if ( c.width ) {
				col.style.width = c.width;
			}
			out.push( col );
		}
		colgroup.replaceChildren( ...out );
	}

	private _paintHead(
		thead: Element,
		cols: OsTableColumn< T >[],
		stickyN: number,
	): void {
		// Header row is rebuilt every paint (sort indicators change with
		// the cycle). The filter row is preserved across paints — its
		// `<th>` cells host live state (text input caret, mounted
		// `filterRender` controls like `<os-multiselect>` whose popover
		// would `_closePopover()` on `disconnectedCallback` if we tore
		// down the row). We swap the header in place and only touch the
		// filter row's cells when the column set changes.
		const newHeaderRow = document.createElement( 'tr' );
		newHeaderRow.setAttribute( 'part', 'header-row' );
		for ( let i = 0; i < cols.length; i++ ) {
			newHeaderRow.appendChild( this._buildHeaderCell( cols[ i ], i, stickyN ) );
		}

		const existingHeader = thead.querySelector< HTMLTableRowElement >(
			':scope > tr[part="header-row"]',
		);
		if ( existingHeader ) {
			thead.replaceChild( newHeaderRow, existingHeader );
		} else {
			thead.insertBefore( newHeaderRow, thead.firstChild );
		}

		// Render the filter row if ANY column requests one — either via
		// the legacy `filter` flag, or via an explicit `filterOptions`
		// list (even if empty — the column's options may still be
		// loading), or via a `filterRender` callback (custom control).
		const hasFilter = cols.some(
			( c ) =>
				c.filter ||
				Array.isArray( c.filterOptions ) ||
				typeof c.filterRender === 'function',
		);
		let existingFilter = thead.querySelector< HTMLTableRowElement >(
			':scope > tr.filter-row',
		);

		if ( hasFilter ) {
			// `_buildFilterCell` returns the cached `<th>` when the
			// column's filter kind hasn't changed, so mounted controls
			// (popovers, inputs with focus) are reused.
			const cells: HTMLTableCellElement[] = [];
			for ( let i = 0; i < cols.length; i++ ) {
				cells.push( this._buildFilterCell( cols[ i ], i, stickyN ) );
			}
			if ( ! existingFilter ) {
				existingFilter = document.createElement( 'tr' );
				existingFilter.classList.add( 'filter-row' );
				existingFilter.setAttribute( 'part', 'filter-row' );
				thead.appendChild( existingFilter );
			}
			const current = Array.from( existingFilter.children );
			let same = current.length === cells.length;
			if ( same ) {
				for ( let i = 0; i < cells.length; i++ ) {
					if ( current[ i ] !== cells[ i ] ) {
						same = false;
						break;
					}
				}
			}
			if ( ! same ) {
				// Move the wanted cells into place (appending an
				// already-attached element reparents without firing
				// disconnectedCallback). Drop any stragglers from
				// removed columns afterwards.
				const wanted = new Set< Element >( cells );
				for ( const cell of cells ) {
					existingFilter.appendChild( cell );
				}
				for ( const child of Array.from( existingFilter.children ) ) {
					if ( ! wanted.has( child ) ) {
						existingFilter.removeChild( child );
					}
				}
			}
		} else if ( existingFilter ) {
			existingFilter.remove();
		}
	}

	private _buildHeaderCell(
		col: OsTableColumn< T >,
		index: number,
		stickyN: number,
	): HTMLTableCellElement {
		const th = document.createElement( 'th' );
		th.setAttribute( 'scope', 'col' );
		th.dataset.key = col.key;
		this._applyCellClasses( th, col, index, stickyN );
		if ( col.minWidth ) {
			th.style.minWidth = col.minWidth;
		}

		if ( col.key === SELECT_KEY ) {
			const mode = this._readSelectable();
			if ( mode === 'multi' ) {
				const cb = document.createElement( 'input' );
				cb.type = 'checkbox';
				cb.className = 'select-all-checkbox';
				cb.setAttribute( 'data-noclick', '' );
				cb.setAttribute( 'aria-label', 'Select all rows' );
				const { total, selected } = this._visibleSelectionStats();
				cb.checked = total > 0 && selected === total;
				cb.indeterminate = selected > 0 && selected < total;
				cb.addEventListener( 'change', () => {
					if ( cb.checked ) {
						this.selectAll();
					} else {
						this.clearSelection();
					}
				} );
				th.appendChild( cb );
			}
			return th;
		}

		th.textContent =
			col.label ?? ( col.key === EXPANDER_KEY ? '' : col.key );

		if ( col.sortable ) {
			th.classList.add( 'is-sortable' );
			const isActive = this._sort?.key === col.key;
			const indicator = document.createElement( 'span' );
			indicator.className = 'sort-indicator';
			let arrow = '';
			if ( isActive ) {
				arrow = this._sort!.direction === 'asc' ? ' ▲' : ' ▼';
			}
			indicator.textContent = arrow;
			th.appendChild( indicator );
			if ( isActive ) {
				th.classList.add(
					this._sort!.direction === 'asc' ? 'sort-asc' : 'sort-desc',
				);
			}
			th.addEventListener( 'click', () => this._cycleSort( col.key ) );
		}

		return th;
	}

	private _buildFilterCell(
		col: OsTableColumn< T >,
		index: number,
		stickyN: number,
	): HTMLTableCellElement {
		const cached = this._filterCache.get( col.key );
		const hasExplicitOptions = Array.isArray( col.filterOptions );
		const hasCustomRender = typeof col.filterRender === 'function';
		let desiredKind: FilterInputCache[ 'kind' ];
		if (
			( ! col.filter && ! hasExplicitOptions && ! hasCustomRender ) ||
			col.key === EXPANDER_KEY ||
			col.key === SELECT_KEY
		) {
			desiredKind = 'none';
		} else if ( hasCustomRender ) {
			desiredKind = 'custom';
		} else if ( col.filter === 'select' || hasExplicitOptions ) {
			desiredKind = 'select';
		} else {
			desiredKind = 'text';
		}

		if ( cached && cached.kind === desiredKind ) {
			cached.th.className = '';
			this._applyCellClasses( cached.th, col, index, stickyN );
			if ( desiredKind === 'select' ) {
				const select = cached.control as HTMLSelectElement;
				const opts = this._resolveFilterOptions( col );
				const optsKey = opts.map( ( o ) => o.value ).join( '|' );
				if ( optsKey !== cached.optionsKey ) {
					this._populateSelect( select, opts, this._filters[ col.key ] ?? '' );
					cached.optionsKey = optsKey;
				} else {
					select.value = this._filters[ col.key ] ?? '';
				}
			} else if ( desiredKind === 'text' ) {
				const input = cached.control as HTMLInputElement;
				const want = this._filters[ col.key ] ?? '';
				if ( input.value !== want && input.ownerDocument.activeElement !== input ) {
					input.value = want;
				}
			} else if ( desiredKind === 'custom' && col.filterRender ) {
				col.filterRender( cached.th, {
					value: this._filters[ col.key ] ?? '',
					setValue: ( next ) => this._onFilterChange( col.key, next ),
					col,
				} );
			}
			return cached.th;
		}

		const th = document.createElement( 'th' );
		this._applyCellClasses( th, col, index, stickyN );

		if ( desiredKind === 'none' ) {
			this._filterCache.set( col.key, {
				th,
				control: null,
				optionsKey: '',
				kind: 'none',
			} );
			return th;
		}

		if ( desiredKind === 'custom' && col.filterRender ) {
			col.filterRender( th, {
				value: this._filters[ col.key ] ?? '',
				setValue: ( next ) => this._onFilterChange( col.key, next ),
				col,
			} );
			this._filterCache.set( col.key, {
				th,
				control: null,
				optionsKey: '',
				kind: 'custom',
			} );
			return th;
		}

		let control: HTMLInputElement | HTMLSelectElement;
		let optionsKey = '';
		if ( desiredKind === 'select' ) {
			const select = document.createElement( 'select' );
			select.classList.add( 'filter-select' );
			select.setAttribute( 'data-noclick', '' );
			select.setAttribute(
				'aria-label',
				`Filter ${ col.label ?? col.key }`,
			);
			const opts = this._resolveFilterOptions( col );
			this._populateSelect( select, opts, this._filters[ col.key ] ?? '' );
			optionsKey = opts.map( ( o ) => o.value ).join( '|' );
			select.addEventListener( 'change', () => {
				this._onFilterChange( col.key, select.value );
			} );
			control = select;
		} else {
			const input = document.createElement( 'input' );
			input.type = 'search';
			input.classList.add( 'filter-input' );
			input.setAttribute( 'data-noclick', '' );
			input.setAttribute( 'placeholder', 'Filter…' );
			input.setAttribute( 'aria-label', `Filter ${ col.label ?? col.key }` );
			input.value = this._filters[ col.key ] ?? '';
			input.addEventListener( 'input', () => {
				this._onFilterChange( col.key, input.value );
			} );
			control = input;
		}
		th.appendChild( control );
		this._filterCache.set( col.key, {
			th,
			control,
			optionsKey,
			kind: desiredKind,
		} );
		return th;
	}

	private _populateSelect(
		select: HTMLSelectElement,
		options: OsTableColumnFilterOption[],
		current: string,
	): void {
		select.replaceChildren();
		const all = document.createElement( 'option' );
		all.value = '';
		all.textContent = 'All';
		select.appendChild( all );
		for ( const opt of options ) {
			const el = document.createElement( 'option' );
			el.value = opt.value;
			el.textContent = opt.label;
			if ( opt.value === current ) {
				el.selected = true;
			}
			select.appendChild( el );
		}
		select.value = current;
	}

	/**
	 * Resolve the option list for a select-filter column. Explicit
	 * `filterOptions` win — that's the contract for server-driven
	 * tables that need the dropdown to list values not present on
	 * the current page. Without `filterOptions`, fall back to the
	 * unique row values in the column (legacy behaviour for
	 * client-side tables).
	 */
	private _resolveFilterOptions(
		col: OsTableColumn< T >,
	): OsTableColumnFilterOption[] {
		if ( Array.isArray( col.filterOptions ) ) {
			return col.filterOptions;
		}
		return this._uniqueValues( col.key ).map( ( v ) => ( {
			value: v,
			label: v,
		} ) );
	}

	// ------------------------------------------------------------------
	// Body
	// ------------------------------------------------------------------

	private _paintBody(
		tbody: Element,
		cols: OsTableColumn< T >[],
		stickyN: number,
	): void {
		tbody.replaceChildren();

		if ( this.hasAttribute( 'loading' ) ) {
			const count = this._readLoadingRows();
			for ( let i = 0; i < count; i++ ) {
				tbody.appendChild( this._buildSkeletonRow( cols, i ) );
			}
			return;
		}

		const filtered = this._sortedRows( this._filteredRows() );
		if ( filtered.length === 0 ) {
			tbody.appendChild( this._buildEmptyRow( cols.length ) );
			return;
		}
		for ( const { row, index } of filtered ) {
			tbody.appendChild(
				this._stacked
					? this._buildStackedRow( row, index, cols )
					: this._buildBodyRow( row, index, cols, stickyN ),
			);
			if ( this._expanded.has( index ) && this._subTable ) {
				const sub = this._subTable( row, index );
				if ( sub ) {
					tbody.appendChild( this._buildSubTableRow( sub, cols.length ) );
				}
			}
		}
	}

	private _buildEmptyRow( colspan: number ): HTMLTableRowElement {
		const tr = document.createElement( 'tr' );
		tr.classList.add( 'empty' );
		const td = document.createElement( 'td' );
		td.colSpan = colspan;
		// `<slot name="empty">` projects light-DOM content (a CTA, an
		// illustration); when nothing is slotted, the slot's fallback
		// is the `empty` attribute text — so we get rich-or-plain
		// behavior from a single mount path.
		const slot = document.createElement( 'slot' );
		slot.name = 'empty';
		slot.textContent = this.getAttribute( 'empty' ) || 'No data';
		td.appendChild( slot );
		tr.appendChild( td );
		return tr;
	}

	private _buildSkeletonRow(
		cols: OsTableColumn< T >[],
		seed: number,
	): HTMLTableRowElement {
		const tr = document.createElement( 'tr' );
		tr.classList.add( 'skeleton' );
		tr.setAttribute( 'aria-hidden', 'true' );
		for ( const _c of cols ) {
			const td = document.createElement( 'td' );
			const bar = document.createElement( 'span' );
			bar.className = 'skeleton-bar';
			// Slight per-cell width variance so the skeleton doesn't
			// look mechanically uniform.
			const widthPct = 50 + ( ( seed * 7 + tr.children.length * 13 ) % 40 );
			bar.style.width = `${ widthPct }%`;
			td.appendChild( bar );
			tr.appendChild( td );
		}
		return tr;
	}

	private _buildBodyRow(
		row: T,
		rowIndex: number,
		cols: OsTableColumn< T >[],
		stickyN: number,
	): HTMLTableRowElement {
		const tr = document.createElement( 'tr' );
		tr.setAttribute( 'part', 'row' );
		tr.dataset.rowIndex = String( rowIndex );
		const id = this._getRowId( row, rowIndex );
		tr.dataset.rowId = String( id );
		if ( this._selection.has( id ) ) {
			tr.classList.add( 'is-selected' );
		}
		tr.addEventListener( 'click', ( e: Event ) => {
			this._onRowClick( row, rowIndex, e );
		} );
		for ( let i = 0; i < cols.length; i++ ) {
			tr.appendChild(
				this._buildBodyCell( cols[ i ], i, row, rowIndex, stickyN ),
			);
		}
		return tr;
	}

	/**
	 * One row as a card (the `stacked` layout). The system cells —
	 * the checkbox, the expander — stay real cells along the leading
	 * edge; every data column is painted into one `td.stack-body` as
	 * a `.stack-cell` carrying its role (`title`, `meta`, `actions`)
	 * and, for a meta line, the column's label as its caption. The
	 * row keeps its id, its index, its selection class and its click,
	 * so `_syncSelectionDom`, `scrollToRow` and the row-click event
	 * need no second code path.
	 */
	private _buildStackedRow(
		row: T,
		rowIndex: number,
		cols: OsTableColumn< T >[],
	): HTMLTableRowElement {
		const tr = document.createElement( 'tr' );
		tr.setAttribute( 'part', 'row' );
		tr.classList.add( 'stack-row' );
		tr.dataset.rowIndex = String( rowIndex );
		const id = this._getRowId( row, rowIndex );
		tr.dataset.rowId = String( id );
		if ( this._selection.has( id ) ) {
			tr.classList.add( 'is-selected' );
		}
		tr.addEventListener( 'click', ( e: Event ) => {
			this._onRowClick( row, rowIndex, e );
		} );
		const body = document.createElement( 'td' );
		body.className = 'stack-body';
		let dataIndex = 0;
		let span = 0;
		for ( let i = 0; i < cols.length; i++ ) {
			const col = cols[ i ];
			if ( col.key === SELECT_KEY || col.key === EXPANDER_KEY ) {
				tr.appendChild( this._buildBodyCell( col, i, row, rowIndex, 0 ) );
				continue;
			}
			span++;
			const role = stackRole( col, dataIndex++ );
			if ( role === 'hidden' ) {
				continue;
			}
			const cell = document.createElement( 'div' );
			cell.className = `stack-cell stack-${ role }`;
			cell.dataset.key = col.key;
			if ( role === 'meta' && col.label ) {
				const label = document.createElement( 'span' );
				label.className = 'stack-label';
				label.textContent = col.label;
				cell.appendChild( label );
			}
			const value = document.createElement( 'span' );
			value.className = 'stack-value';
			const raw = ( row as Record< string, unknown > )[ col.key ];
			if ( col.render ) {
				this._mountCellContent( value, col.render( raw, row, rowIndex ) );
			} else if ( raw !== null && raw !== undefined ) {
				value.textContent = String( raw );
			}
			cell.appendChild( value );
			body.appendChild( cell );
		}
		body.colSpan = Math.max( 1, span );
		tr.appendChild( body );
		return tr;
	}

	private _buildBodyCell(
		col: OsTableColumn< T >,
		colIndex: number,
		row: T,
		rowIndex: number,
		stickyN: number,
	): HTMLTableCellElement {
		const td = document.createElement( 'td' );
		this._applyCellClasses( td, col, colIndex, stickyN );
		if ( col.minWidth ) {
			td.style.minWidth = col.minWidth;
		}

		if ( col.key === SELECT_KEY ) {
			const id = this._getRowId( row, rowIndex );
			const cb = document.createElement( 'input' );
			cb.type = 'checkbox';
			cb.className = 'select-row-checkbox';
			cb.setAttribute( 'data-noclick', '' );
			cb.setAttribute( 'aria-label', 'Select row' );
			cb.checked = this._selection.has( id );
			cb.addEventListener( 'change', () => {
				if ( cb.checked ) {
					this.select( id );
				} else {
					this.deselect( id );
				}
			} );
			td.appendChild( cb );
			if ( this._stacked ) {
				// On a card the whole leading cell is the tap target
				// (`os-table.styles.ts` gives it 44px), not the 22px box
				// inside it: a tap beside the box toggles the row, and is
				// not also a row click.
				td.setAttribute( 'data-noclick', '' );
				td.addEventListener( 'click', ( e: Event ) => {
					if ( e.target !== td ) {
						return;
					}
					cb.checked = ! cb.checked;
					cb.dispatchEvent( new Event( 'change' ) );
				} );
			}
			return td;
		}

		if ( col.key === EXPANDER_KEY ) {
			const hasChildren = this._subTable
				? !! this._subTable( row, rowIndex )
				: false;
			if ( ! hasChildren ) {
				return td;
			}
			const isOpen = this._expanded.has( rowIndex );
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'expander';
			btn.setAttribute( 'data-noclick', '' );
			btn.setAttribute( 'aria-expanded', isOpen ? 'true' : 'false' );
			btn.setAttribute(
				'aria-label',
				isOpen ? 'Collapse row' : 'Expand row',
			);
			btn.textContent = isOpen ? '▾' : '▸';
			btn.addEventListener( 'click', ( e: Event ) => {
				this._toggleRow( rowIndex, row, e );
			} );
			td.appendChild( btn );
			return td;
		}

		const value = ( row as Record< string, unknown > )[ col.key ];
		if ( col.render ) {
			const out = col.render( value, row, rowIndex );
			this._mountCellContent( td, out );
		} else if ( value !== null && value !== undefined ) {
			td.textContent = String( value );
		}
		return td;
	}

	private _buildSubTableRow(
		sub: Exclude< OsTableSubTableResult, null | undefined >,
		colspan: number,
	): HTMLTableRowElement {
		const tr = document.createElement( 'tr' );
		tr.classList.add( 'subtable' );
		tr.setAttribute( 'part', 'subtable-row' );
		const td = document.createElement( 'td' );
		td.colSpan = colspan;
		const inner = document.createElement( 'div' );
		inner.classList.add( 'subtable-inner' );

		if ( sub instanceof Node ) {
			inner.appendChild( sub );
		} else if ( isTemplateResult( sub ) ) {
			renderTemplate( sub, inner );
		} else {
			const nested = document.createElement( 'os-table' ) as OsTable;
			nested.columns = sub.columns;
			nested.data = sub.data;
			if ( sub.subTable ) {
				nested.subTable = sub.subTable;
			}
			inner.appendChild( nested );
		}

		td.appendChild( inner );
		tr.appendChild( td );
		return tr;
	}

	private _mountCellContent(
		td: HTMLElement,
		out: string | Node | TemplateResult,
	): void {
		if ( typeof out === 'string' ) {
			td.textContent = out;
			return;
		}
		if ( out instanceof Node ) {
			td.appendChild( out );
			return;
		}
		if ( isTemplateResult( out ) ) {
			renderTemplate( out, td );
		}
	}

	// ------------------------------------------------------------------
	// Behavior
	// ------------------------------------------------------------------

	private _onFilterChange( key: string, value: string ): void {
		if ( value === '' ) {
			delete this._filters[ key ];
		} else {
			this._filters[ key ] = value;
		}
		this.emit( 'os-table-filter-change', { filters: { ...this._filters } } );
		// Re-paint body only — filter inputs themselves stay mounted
		// (preserving focus + caret).
		const root = this.shadowRoot;
		const tbody = root?.querySelector( 'tbody' );
		if ( tbody ) {
			const cols = this._effectiveColumns();
			const stickyN = this._readStickyColumns();
			this._lastStickyIndex = this._computeLastStickyIndex( cols, stickyN );
			this._paintBody( tbody, cols, stickyN );
			this._applyStickyOffsets();
		}
	}

	private _onRowClick( row: T, index: number, e: Event ): void {
		const path = ( e as Event & { composedPath?: () => EventTarget[] } ).composedPath?.() ?? [];
		for ( const node of path ) {
			if ( node instanceof Element && node.hasAttribute( 'data-noclick' ) ) {
				return;
			}
			if ( node === this ) {
				break;
			}
		}
		this.emit( 'os-table-row-click', { row, index, originalEvent: e } );
	}

	private _toggleRow( index: number, row: T, e: Event ): void {
		e.stopPropagation();
		const isOpen = this._expanded.has( index );
		if ( isOpen ) {
			this._expanded.delete( index );
		} else {
			this._expanded.add( index );
		}
		this.emit( 'os-table-expand-change', {
			row,
			index,
			expanded: ! isOpen,
		} );
		this._schedulePaint();
	}

	private _cycleSort( key: string ): void {
		if ( ! this._sort || this._sort.key !== key ) {
			this._sort = { key, direction: 'asc' };
		} else if ( this._sort.direction === 'asc' ) {
			this._sort = { key, direction: 'desc' };
		} else {
			this._sort = null;
		}
		this.emit( 'os-table-sort-change', {
			sort: this._sort ? { ...this._sort } : null,
		} );
		this._schedulePaint();
	}

	private _emitSelectionChange(): void {
		this.emit( 'os-table-selection-change', {
			selection: Array.from( this._selection ),
			rows: this.selectedRows,
		} );
	}

	// ------------------------------------------------------------------
	// Filtering + sorting
	// ------------------------------------------------------------------

	private _filteredRows(): Array< { row: T; index: number } > {
		const out: Array< { row: T; index: number } > = [];
		const active = Object.keys( this._filters ).filter(
			( k ) => this._filters[ k ] !== '',
		);
		for ( let i = 0; i < this._data.length; i++ ) {
			const row = this._data[ i ];
			let pass = true;
			for ( const key of active ) {
				const col = this._columns.find( ( c ) => c.key === key );
				// `filterRender` columns own their filter shape — value
				// is opaque to the table (commonly a comma-joined id list
				// for a multi-select). The consumer filters via the
				// server or by reassigning `data`; we must not re-filter
				// here or we drop legitimate rows.
				if ( col && typeof col.filterRender === 'function' ) {
					continue;
				}
				const filter = this._filters[ key ] ?? '';
				const cell = ( row as Record< string, unknown > )[ key ];
				const cellStr = cell === null || cell === undefined ? '' : String( cell );
				if ( col?.filter === 'select' ) {
					if ( cellStr !== filter ) {
						pass = false;
						break;
					}
				} else if ( ! cellStr.toLowerCase().includes( filter.toLowerCase() ) ) {
					pass = false;
					break;
				}
			}
			if ( pass ) {
				out.push( { row, index: i } );
			}
		}
		return out;
	}

	private _sortedRows(
		rows: Array< { row: T; index: number } >,
	): Array< { row: T; index: number } > {
		if ( ! this._sort ) {
			return rows;
		}
		const col = this._columns.find( ( c ) => c.key === this._sort!.key );
		if ( ! col ) {
			return rows;
		}
		const dir = this._sort.direction === 'desc' ? -1 : 1;
		const out = rows.slice();
		out.sort( ( a, b ) => {
			const av = col.sortValue
				? col.sortValue( a.row, ( a.row as Record< string, unknown > )[ col.key ] )
				: ( a.row as Record< string, unknown > )[ col.key ];
			const bv = col.sortValue
				? col.sortValue( b.row, ( b.row as Record< string, unknown > )[ col.key ] )
				: ( b.row as Record< string, unknown > )[ col.key ];
			return compareValues( av, bv ) * dir;
		} );
		return out;
	}

	private _uniqueValues( key: string ): string[] {
		const seen = new Set< string >();
		for ( const row of this._data ) {
			const v = ( row as Record< string, unknown > )[ key ];
			if ( v === null || v === undefined ) {
				continue;
			}
			seen.add( String( v ) );
		}
		return Array.from( seen ).sort();
	}

	/**
	 * Selection stats over the VISIBLE (client-side-filtered) rows —
	 * the same set `selectAll()` operates on. The header select-all
	 * tri-state derives from these so "checked" always means "every
	 * row the user can see is selected", even while ids of currently
	 * hidden rows linger in the selection set.
	 */
	private _visibleSelectionStats(): { total: number; selected: number } {
		let total = 0;
		let selected = 0;
		for ( const { row, index } of this._filteredRows() ) {
			total++;
			if ( this._selection.has( this._getRowId( row, index ) ) ) {
				selected++;
			}
		}
		return { total, selected };
	}

	// ------------------------------------------------------------------
	// Sticky columns + attribute reads
	// ------------------------------------------------------------------

	private _readStickyColumns(): number {
		const raw = parseInt( this.getAttribute( 'sticky-columns' ) || '0', 10 );
		return Number.isFinite( raw ) && raw > 0 ? raw : 0;
	}

	private _readLoadingRows(): number {
		const raw = parseInt( this.getAttribute( 'loading-rows' ) || '5', 10 );
		return Number.isFinite( raw ) && raw > 0 ? Math.min( raw, 100 ) : 5;
	}

	private _readSelectable(): 'single' | 'multi' | null {
		const v = this.getAttribute( 'selectable' );
		if ( v === 'single' ) {
			return 'single';
		}
		if ( v === 'multi' || v === '' ) {
			return 'multi';
		}
		return null;
	}

	/**
	 * Sticky-band membership. The first N columns get pinned, with two
	 * per-column overrides: `column.sticky = true` opts in even outside
	 * the band; `column.sticky = false` opts out within it.
	 */
	private _isStickyIndex(
		index: number,
		stickyN: number,
		col: OsTableColumn< T >,
	): boolean {
		// A card has no columns to pin; `column.sticky` and the
		// attribute both stand down while the layout is stacked.
		if ( this._stacked || col.sticky === false ) {
			return false;
		}
		if ( col.sticky === true ) {
			return true;
		}
		return index < stickyN;
	}

	/**
	 * The highest column index that resolves to sticky for the current
	 * column set. -1 when no column is sticky. The "edge" cell — the one
	 * that gets the visible right divider — is at this index. We compute
	 * this by scanning rather than reusing `stickyN - 1` because
	 * `column.sticky = true` can opt a column in past the count, and
	 * `column.sticky = false` can carve a hole inside the band.
	 */
	private _lastStickyIndex = -1;
	private _computeLastStickyIndex(
		cols: OsTableColumn< T >[],
		stickyN: number,
	): number {
		let last = -1;
		for ( let i = 0; i < cols.length; i++ ) {
			if ( this._isStickyIndex( i, stickyN, cols[ i ] ) ) {
				last = i;
			}
		}
		return last;
	}

	private _applyCellClasses(
		cell: HTMLElement,
		col: OsTableColumn< T >,
		index: number,
		stickyN: number,
	): void {
		if ( col.key === EXPANDER_KEY ) {
			cell.classList.add( 'col-expander' );
		}
		if ( col.key === SELECT_KEY ) {
			cell.classList.add( 'col-select' );
		}
		if ( col.align === 'center' ) {
			cell.classList.add( 'align-center' );
		}
		if ( col.align === 'end' ) {
			cell.classList.add( 'align-end' );
		}
		const sticky = this._isStickyIndex( index, stickyN, col );
		if ( sticky ) {
			cell.classList.add( 'is-sticky' );
			if ( index === this._lastStickyIndex ) {
				cell.classList.add( 'is-sticky-edge' );
			}
		}
	}

	private _effectiveColumns(): OsTableColumn< T >[] {
		const out: OsTableColumn< T >[] = [];
		if ( this._readSelectable() ) {
			out.push( {
				key: SELECT_KEY,
				label: '',
				// The descriptor width is painted onto a `<col>`
				// element and is the authoritative column-width
				// source in table-layout: auto — CSS `td { width }`
				// is ignored once `<col>` has a value. Pair with
				// the matching `td.col-select` rule (zero
				// `padding-inline`, `text-align: center`) so the
				// checkbox sits with breathing room on both sides.
				width: '40px',
				align: 'center',
			} );
		}
		if ( this._subTable ) {
			out.push( {
				key: EXPANDER_KEY,
				label: '',
				// Same contract as col-select. 36px column +
				// 20px button + zero padding centers the chevron
				// with ~8px on each side.
				width: '36px',
				align: 'center',
			} );
		}
		out.push( ...this._columns );
		return out;
	}

	/**
	 * Walk the header row, sum the natural widths of the sticky cells,
	 * then write cumulative `inset-inline-start` offsets onto every
	 * row's matching cells.
	 */
	private _applyStickyOffsets(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const headRow = root.querySelector( 'thead tr' );
		if ( ! headRow ) {
			return;
		}
		const ths = Array.from( headRow.children ) as HTMLElement[];
		const offsets: number[] = [];
		let acc = 0;
		for ( let i = 0; i < ths.length; i++ ) {
			offsets[ i ] = acc;
			if ( ths[ i ].classList.contains( 'is-sticky' ) ) {
				acc += ths[ i ].offsetWidth;
			}
		}
		const rows = root.querySelectorAll(
			'thead tr, tbody tr:not(.subtable):not(.empty):not(.skeleton)',
		);
		rows.forEach( ( r ) => {
			const cells = Array.from( ( r as HTMLElement ).children ) as HTMLElement[];
			for ( let i = 0; i < cells.length; i++ ) {
				if ( cells[ i ].classList.contains( 'is-sticky' ) ) {
					cells[ i ].style.insetInlineStart = `${ offsets[ i ] }px`;
				}
			}
		} );

		// Diagnostic: when sticky-columns >= 2, the second pinned cell
		// MUST land at a non-zero offset (it's the cumulative width of
		// the first). If we computed 0 and the host has a real width
		// (so it's not just hidden), something measured pre-layout —
		// usually a paint that happened while the panel was mid-
		// transition. Tell the developer once, with the actual values,
		// so they're not staring at DevTools wondering which side of
		// the contract is broken.
		this._maybeWarnStickyOffsetRace( ths, offsets );
	}

	private _maybeWarnStickyOffsetRace(
		ths: HTMLElement[],
		offsets: number[],
	): void {
		if ( this._stickyRaceWarned ) {
			return;
		}
		const stickyN = this._readStickyColumns();
		if ( stickyN < 2 ) {
			return;
		}
		const lastIdx = Math.min( stickyN - 1, ths.length - 1 );
		if ( lastIdx <= 0 ) {
			return;
		}
		if ( offsets[ lastIdx ] !== 0 ) {
			return;
		}
		// If the host has zero width (display: none, jsdom, hidden tab
		// before first show), it's not a race — it's "haven't mounted
		// visibly yet". The ResizeObserver will fire when it does, and
		// we'll recompute correctly. Don't burn a warning on that.
		if ( this.offsetWidth === 0 ) {
			return;
		}
		this._stickyRaceWarned = true;
		const w0 = ths[ 0 ]?.offsetWidth ?? 0;
		// eslint-disable-next-line no-console
		console.warn(
			`[os-table] sticky-columns: column ${ lastIdx } resolved to ` +
				`inset-inline-start: 0px while the host is visible. ` +
				`ths[0].offsetWidth was ${ w0 }px at measurement time. ` +
				'Likely a layout race — call recomputeLayout() after the ' +
				'panel finishes its mount/transition, or wrap the assignment ' +
				'of `data` in a requestAnimationFrame.',
		);
	}

	private _measureHeaderHeight(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const headRow = root.querySelector( 'thead tr' ) as HTMLElement | null;
		if ( ! headRow ) {
			return;
		}
		const h = headRow.offsetHeight;
		if ( h > 0 ) {
			this.style.setProperty( '--os-ui-table-header-height', `${ h }px` );
		}
	}

	/**
	 * Once-per-element warning for the most common sticky-header
	 * mistake: forgetting to give the table a scroll container. Without
	 * a max-height (or a scrolling ancestor), `position: sticky`
	 * silently does nothing because there's no scrollport for it to
	 * stick within.
	 */
	private _maybeWarnStickyHeader(): void {
		if ( this._stickyHeaderWarned ) {
			return;
		}
		if ( ! this.hasAttribute( 'sticky-header' ) ) {
			return;
		}
		// Need enough rows to actually need scrolling; bail on
		// loading / tiny tables to avoid a false positive on the first
		// paint of an async data table.
		if ( this.hasAttribute( 'loading' ) || this._data.length < 8 ) {
			return;
		}
		const scroll = this.shadowRoot?.querySelector(
			'.scroll',
		) as HTMLElement | null;
		if ( ! scroll ) {
			return;
		}
		// If the inner content can fit without scrolling, sticky is
		// inert. The offsetWidth check guards against zero-layout
		// (jsdom, hidden) where every measurement is 0 and would false-
		// positive every time.
		if ( scroll.offsetWidth === 0 ) {
			return;
		}
		if ( scroll.scrollHeight <= scroll.clientHeight + 1 ) {
			this._stickyHeaderWarned = true;
			// eslint-disable-next-line no-console
			console.warn(
				'[os-table] sticky-header is set but the table has no scroll container. ' +
					'Set --os-ui-table-max-height on the host (or wrap it in a scrolling parent) so the header has something to stick to.',
			);
		}
	}
}

function isTemplateResult( v: unknown ): v is TemplateResult {
	return !! v && ( v as { __wpdHtml?: boolean } ).__wpdHtml === true;
}

/**
 * A column's role inside a stacked row: its own `stack` when set,
 * else the first data column is the title, a label-less column is
 * the actions row (that is what a label-less column IS in every
 * table in the shell — the trailing buttons), and the rest are
 * meta lines.
 */
export function stackRole(
	col: Pick< OsTableColumn, 'label' | 'stack' >,
	dataIndex: number,
): OsTableStackRole {
	if ( col.stack ) {
		return col.stack;
	}
	if ( dataIndex === 0 ) {
		return 'title';
	}
	return col.label ? 'meta' : 'actions';
}

/**
 * Sort comparator. Numbers compare numerically; everything else falls
 * back to a locale-aware string compare. `null` / `undefined` sort
 * before any concrete value so unsorted data lands at the top.
 */
function compareValues( a: unknown, b: unknown ): number {
	if ( a === b ) {
		return 0;
	}
	if ( a === null || a === undefined ) {
		return -1;
	}
	if ( b === null || b === undefined ) {
		return 1;
	}
	if ( typeof a === 'number' && typeof b === 'number' ) {
		return a - b;
	}
	if ( a instanceof Date && b instanceof Date ) {
		return a.getTime() - b.getTime();
	}
	const an = Number( a );
	const bn = Number( b );
	if ( Number.isFinite( an ) && Number.isFinite( bn ) ) {
		return an - bn;
	}
	return String( a ).localeCompare( String( b ) );
}

defineComponent( 'os-table', OsTable );
