import { Component, defineComponent, html, render as renderTemplate, type TemplateResult } from '../../core';
import { styles } from './os-table.styles';

export interface OsTableColumnFilterOption {

	value: string;

	label: string;
}

export interface OsTableColumn< T = Record< string, unknown > > {

	key: string;

	label?: string;

	filter?: boolean | 'text' | 'select';

	filterOptions?: OsTableColumnFilterOption[];

	filterRender?: (
		host: HTMLTableCellElement,
		ctx: {
			value: string;
			setValue: ( next: string ) => void;
			col: OsTableColumn< T >;
		},
	) => void;

	sortable?: boolean;

	sortValue?: ( row: T, value: unknown ) => unknown;

	sticky?: boolean;

	align?: 'start' | 'center' | 'end';

	width?: string;

	minWidth?: string;

	render?: ( value: unknown, row: T, index: number ) => string | Node | TemplateResult;

	stack?: OsTableStackRole;
}

export type OsTableStackRole = 'title' | 'meta' | 'actions' | 'hidden';

export type OsTableSubTableResult =
	| null
	| undefined
	| Node
	| TemplateResult
	| {
		columns: OsTableColumn< Record< string, unknown > >[];
		data: Record< string, unknown >[];

		subTable?: OsTableSubTableFn;
	};

export type OsTableSubTableFn< T = Record< string, unknown > > = (
	row: T,
	index: number,
) => OsTableSubTableResult;

export type OsTableFilters = Record< string, string >;

export type OsTableSort =
	| { key: string; direction: 'asc' | 'desc' }
	| null;

export type OsTableRowId = string | number;

export type OsTableGetRowId< T = Record< string, unknown > > = (
	row: T,
	index: number,
) => OsTableRowId;

const EXPANDER_KEY = '__wpd_expander__';
const SELECT_KEY = '__wpd_select__';

interface FilterInputCache {

	th: HTMLTableCellElement;

	control: HTMLInputElement | HTMLSelectElement | null;

	optionsKey: string;

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

	private _filterCache = new Map< string, FilterInputCache >();

	private _paintScheduled = false;

	private _stacked = false;
	private _stickyHeaderWarned = false;
	private _stickyRaceWarned = false;
	private _resizeObserver: ResizeObserver | null = null;
	private _stickyMicroScheduled = false;
	private _stickyRafHandle: number | null = null;

	get data(): readonly T[] {
		return this._data;
	}
	set data( next: readonly T[] | null | undefined ) {
		this._data = Array.isArray( next ) ? next.slice() : [];
		this._expanded.clear();

		this._schedulePaint();
	}

	get columns(): readonly OsTableColumn< T >[] {
		return this._columns;
	}
	set columns( next: readonly OsTableColumn< T >[] | null | undefined ) {
		this._columns = Array.isArray( next ) ? next.slice() : [];

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

	get filters(): Readonly< OsTableFilters > {
		return { ...this._filters };
	}
	set filters( next: OsTableFilters | null | undefined ) {
		this._filters = next ? { ...next } : {};
		this._schedulePaint();
	}

	get sort(): OsTableSort {
		return this._sort ? { ...this._sort } : null;
	}
	set sort( next: OsTableSort | undefined ) {
		this._sort = next ? { ...next } : null;
		this._schedulePaint();
	}

	get selection(): ReadonlySet< OsTableRowId > {
		return new Set( this._selection );
	}
	set selection( next: Iterable< OsTableRowId > | null | undefined ) {
		this._selection = new Set( next ?? [] );
		this._schedulePaint();
	}

	get selectedRows(): T[] {
		const out: T[] = [];
		this._data.forEach( ( row, i ) => {
			if ( this._selection.has( this._getRowId( row, i ) ) ) {
				out.push( row );
			}
		} );
		return out;
	}

	get visibleRows(): T[] {
		return this._filteredRows().map( ( entry ) => entry.row );
	}

	get getRowId(): OsTableGetRowId< T > {
		return this._getRowId;
	}
	set getRowId( fn: OsTableGetRowId< T > | null | undefined ) {
		this._getRowId = typeof fn === 'function' ? fn : ( ( _r, i ) => i );
		this._schedulePaint();
	}

	get subTable(): OsTableSubTableFn< T > | null {
		return this._subTable;
	}
	set subTable( fn: OsTableSubTableFn< T > | null | undefined ) {
		this._subTable = typeof fn === 'function' ? fn : null;
		this._expanded.clear();
		this._schedulePaint();
	}

	get expanded(): ReadonlySet< number > {
		return new Set( this._expanded );
	}
	set expanded( next: Iterable< number > | null | undefined ) {
		this._expanded = new Set( next ?? [] );
		this._schedulePaint();
	}

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

	clearFilters(): void {
		if ( Object.keys( this._filters ).length === 0 ) {
			return;
		}
		this._filters = {};
		this.emit( 'os-table-filter-change', { filters: {} } );
		this._schedulePaint();
	}

	clearSort(): void {
		if ( this._sort === null ) {
			return;
		}
		this._sort = null;
		this.emit( 'os-table-sort-change', { sort: null } );
		this._schedulePaint();
	}

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

	deselect( id: OsTableRowId ): void {
		if ( ! this._selection.delete( id ) ) {
			return;
		}
		this._emitSelectionChange();
		this._syncSelectionDom( [ id ] );
	}

	selectAll(): void {
		if ( this._readSelectable() !== 'multi' ) {
			return;
		}

		for ( const { row, index } of this._filteredRows() ) {
			this._selection.add( this._getRowId( row, index ) );
		}
		this._emitSelectionChange();
		this._syncSelectionDom( 'all' );
	}

	clearSelection(): void {
		if ( this._selection.size === 0 ) {
			return;
		}
		this._selection.clear();
		this._emitSelectionChange();
		this._syncSelectionDom( 'all' );
	}

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

		const headerCb = root.querySelector< HTMLInputElement >(
			'thead .select-all-checkbox',
		);
		if ( headerCb ) {
			const { total, selected } = this._visibleSelectionStats();
			headerCb.checked = total > 0 && selected === total;
			headerCb.indeterminate = selected > 0 && selected < total;
		}
	}

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

	recomputeLayout(): void {
		this._applyStickyOffsets();
		this._measureHeaderHeight();
	}

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

		this._applyStickyOffsets();
		this._measureHeaderHeight();
		this._scheduleStickyOffsets();
		this._maybeWarnStickyHeader();
		this._maybeWarnLoadingDesync( tbody );
		this._ensureResizeObserver();
	}

	private _loadingDesyncWarned = false;

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

		console.warn(
			'[os-table] `loading` attribute is set but no skeleton rows ' +
				'rendered. Either attributeChangedCallback didn\'t route through ' +
				'requestUpdate (framework regression), or `loading` was set after ' +
				'the most recent paint and no follow-up trigger ran. Toggling ' +
				'`data` will force a paint as a workaround.',
		);
	}

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

			this._stickyHeaderWarned = false;
			this._maybeWarnStickyHeader();
		} );
		this._resizeObserver.observe( scroll );

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
		if ( this._stacked ) {
			tr.classList.add( 'stack-row' );
			const td = document.createElement( 'td' );
			td.className = 'stack-body';
			td.colSpan = Math.max( 1, cols.length );
			for ( const widthPct of [ 55 + ( ( seed * 7 ) % 25 ), 30 + ( ( seed * 11 ) % 15 ) ] ) {
				const bar = document.createElement( 'span' );
				bar.className = 'skeleton-bar';
				bar.style.width = `${ widthPct }%`;
				td.appendChild( bar );
			}
			tr.appendChild( td );
			return tr;
		}
		for ( const _c of cols ) {
			const td = document.createElement( 'td' );
			const bar = document.createElement( 'span' );
			bar.className = 'skeleton-bar';

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
			const rawSlot = slotName( raw );
			if ( col.render ) {
				this._mountCellContent( value, col.render( raw, row, rowIndex ) );
			} else if ( rawSlot !== null ) {
				value.appendChild( this._slotFor( rawSlot ) );
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
		const valueSlot = slotName( value );
		if ( col.render ) {
			const out = col.render( value, row, rowIndex );
			this._mountCellContent( td, out );
		} else if ( valueSlot !== null ) {
			td.appendChild( this._slotFor( valueSlot ) );
		} else if ( value !== null && value !== undefined ) {
			td.textContent = String( value );
		}
		return td;
	}

	private _slotFor( name: string ): HTMLSlotElement {
		const slot = document.createElement( 'slot' );
		slot.name = name;
		return slot;
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

	private _onFilterChange( key: string, value: string ): void {
		if ( value === '' ) {
			delete this._filters[ key ];
		} else {
			this._filters[ key ] = value;
		}
		this.emit( 'os-table-filter-change', { filters: { ...this._filters } } );

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

				if ( col && typeof col.filterRender === 'function' ) {
					continue;
				}
				const filter = this._filters[ key ] ?? '';
				const cell = ( row as Record< string, unknown > )[ key ];
				const cellStr = cellText( cell );
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
			const ar = ( a.row as Record< string, unknown > )[ col.key ];
			const br = ( b.row as Record< string, unknown > )[ col.key ];
			const av = col.sortValue ? col.sortValue( a.row, ar ) : sortKey( ar );
			const bv = col.sortValue ? col.sortValue( b.row, br ) : sortKey( br );
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
			seen.add( cellText( v ) );
		}
		return Array.from( seen ).sort();
	}

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

	private _isStickyIndex(
		index: number,
		stickyN: number,
		col: OsTableColumn< T >,
	): boolean {
		if ( this._stacked || col.sticky === false ) {
			return false;
		}
		if ( col.sticky === true ) {
			return true;
		}
		return index < stickyN;
	}

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

				width: '40px',
				align: 'center',
			} );
		}
		if ( this._subTable ) {
			out.push( {
				key: EXPANDER_KEY,
				label: '',

				width: '36px',
				align: 'center',
			} );
		}
		out.push( ...this._columns );
		return out;
	}

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

		if ( this.offsetWidth === 0 ) {
			return;
		}
		this._stickyRaceWarned = true;
		const w0 = ths[ 0 ]?.offsetWidth ?? 0;

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

	private _maybeWarnStickyHeader(): void {
		if ( this._stickyHeaderWarned ) {
			return;
		}
		if ( ! this.hasAttribute( 'sticky-header' ) ) {
			return;
		}

		if ( this.hasAttribute( 'loading' ) || this._data.length < 8 ) {
			return;
		}
		const scroll = this.shadowRoot?.querySelector(
			'.scroll',
		) as HTMLElement | null;
		if ( ! scroll ) {
			return;
		}

		if ( scroll.offsetWidth === 0 ) {
			return;
		}
		if ( scroll.scrollHeight <= scroll.clientHeight + 1 ) {
			this._stickyHeaderWarned = true;

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

function slotName( value: unknown ): string | null {
	if ( value && typeof value === 'object' && typeof ( value as { slot?: unknown } ).slot === 'string' ) {
		return ( value as { slot: string } ).slot;
	}
	return null;
}

function cellText( value: unknown ): string {
	if ( value === null || value === undefined ) {
		return '';
	}
	if ( slotName( value ) !== null ) {
		const t = ( value as { text?: unknown } ).text;
		return t === null || t === undefined ? '' : String( t );
	}
	return String( value );
}

function sortKey( value: unknown ): unknown {
	return slotName( value ) !== null ? cellText( value ) : value;
}

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
