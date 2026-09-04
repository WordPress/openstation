/**
 * App Framework — keeping a preserved `<os-table>` in step with a
 * client view.
 *
 * A list window renders its `<os-table>` once, marked `os-preserve`,
 * and drives it from `updated()`: the component owns its own DOM and
 * a re-render must not rebuild the cells, the pickers or the scroll
 * position. Every list window then does the same four things on every
 * paint — a card list on a phone (and the columns built for it), the
 * one-time wiring, a selection cleared when the QUERY changes (an id
 * picked under the previous page must not ride into the next bulk
 * action), and the rows assigned only when they actually changed with
 * the selection pruned to what is still visible. Four windows wrote
 * that by hand; this owns it.
 *
 * Usage, in a client view:
 *
 *   // in the ui bag:   table: createListTableSync< Row >(),
 *   // in updated():    ui.table.sync( {
 *   //     table: ctx.root.querySelector( '[data-my-table]' ),
 *   //     rows, listKey: `${ state.page }|${ state.search }`,
 *   //     fingerprint: rows.map( ( r ) => `${ r.id }:${ r.modified }` ).join( '|' ),
 *   //     columns: ( phone ) => buildColumns( phone ),
 *   //     wire: ( table ) => { table.sort = …; table.addEventListener( … ); },
 *   // } );
 *
 * @public
 */

import { stackOnPhone } from '../ui/components/os-table/stack-on-phone';

/** The slice of `<os-table>` the sync drives — typed loosely so tests can hand in a stub. */
export interface ListTableLike< Row > extends Element {
	columns: unknown;
	data: Row[];
	selection?: Iterable< string | number > | null;
	visibleRows?: Row[];
	clearSelection: () => void;
}

export interface ListTableSyncOptions< Row > {
	/** The preserved table, or null before it is in the DOM (a no-op then). */
	table: ListTableLike< Row > | null;
	/** The rows to show. */
	rows: Row[];
	/** The query's identity (page, search, filters, sort): a change clears the selection. */
	listKey: string;
	/** Change detection for `rows`: an unchanged key skips the `data` assignment. */
	fingerprint: string;
	/** The columns for a desk (`false`) or a phone (`true`); rebuilt when the answer changes or after `invalidateColumns()`. */
	columns: ( phone: boolean ) => unknown;
	/** One-time wiring: `getRowId`, the default sort, listeners. */
	wire?: ( table: ListTableLike< Row > ) => void;
	/** Row identity, matching the table's `getRowId`. Default `row.id`. */
	rowId?: ( row: Row ) => string | number;
	/** The selection was pruned to the visible rows (or cleared); `kept` is what survived. */
	onSelection?: ( kept: string[] ) => void;
}

export interface ListTableSyncResult {
	phone: boolean;
	columnsChanged: boolean;
	dataChanged: boolean;
	selectionChanged: boolean;
}

export interface ListTableSync< Row > {
	/** Run the four steps against the current paint. */
	sync( opts: ListTableSyncOptions< Row > ): ListTableSyncResult;
	/** Rebuild the columns on the next `sync()` (a hidden-columns change, fresh filter options). */
	invalidateColumns(): void;
	/** Assign the rows again on the next `sync()` even if the fingerprint matches. */
	invalidateData(): void;
}

function selectionKeys( table: ListTableLike< unknown > ): string[] {
	return Array.from( table.selection ?? [], String );
}

export function createListTableSync< Row >(): ListTableSync< Row > {
	let phoneColumns: boolean | null = null;
	let wired = false;
	let listKey: string | null = null;
	let fingerprint: string | null = null;

	return {
		invalidateColumns() {
			phoneColumns = null;
		},
		invalidateData() {
			fingerprint = null;
		},
		sync( opts ) {
			const result: ListTableSyncResult = {
				phone: false,
				columnsChanged: false,
				dataChanged: false,
				selectionChanged: false,
			};
			const table = opts.table;
			if ( ! table ) {
				return result;
			}
			const rowId = opts.rowId ?? ( ( row: Row ) => ( row as { id: string | number } ).id );

			// A card per row on a phone, and the columns built for it —
			// rebuilt only when the answer changes.
			const phone = stackOnPhone( table );
			result.phone = phone;
			if ( phone !== phoneColumns ) {
				phoneColumns = phone;
				table.columns = opts.columns( phone );
				result.columnsChanged = true;
			}

			if ( ! wired ) {
				wired = true;
				opts.wire?.( table );
			}

			// A query change replaces the result set wholesale — ids picked
			// under the previous view must not linger invisibly.
			if ( opts.listKey !== listKey ) {
				listKey = opts.listKey;
				if ( selectionKeys( table ).length > 0 ) {
					table.clearSelection();
					result.selectionChanged = true;
					opts.onSelection?.( [] );
				}
			}

			// Assign the rows only when they changed, so a selection or
			// expand repaint never rebuilds the cells; then prune the
			// selection to the rows still on screen so a bulk bar's count
			// stays truthful.
			if ( opts.fingerprint !== fingerprint ) {
				fingerprint = opts.fingerprint;
				table.data = opts.rows;
				result.dataChanged = true;
				const visible = new Set( opts.rows.map( ( row ) => String( rowId( row ) ) ) );
				const before = selectionKeys( table );
				const kept = before.filter( ( key ) => visible.has( key ) );
				if ( kept.length !== before.length ) {
					( table as { selection: unknown } ).selection = kept;
					result.selectionChanged = true;
					opts.onSelection?.( kept );
				}
			}
			return result;
		},
	};
}
