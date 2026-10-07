import { stackOnPhone } from '../ui/components/os-table/stack-on-phone';

export interface ListTableLike< Row > extends Element {
	columns: unknown;
	data: Row[];
	selection?: Iterable< string | number > | null;
	visibleRows?: Row[];
	clearSelection: () => void;
}

export interface ListTableSyncOptions< Row > {

	table: ListTableLike< Row > | null;

	rows: Row[];

	listKey: string;

	fingerprint: string;

	columns: ( phone: boolean ) => unknown;

	wire?: ( table: ListTableLike< Row > ) => void;

	rowId?: ( row: Row ) => string | number;

	onSelection?: ( kept: string[] ) => void;
}

export interface ListTableSyncResult {
	phone: boolean;
	columnsChanged: boolean;
	dataChanged: boolean;
	selectionChanged: boolean;
}

export interface ListTableSync< Row > {

	sync( opts: ListTableSyncOptions< Row > ): ListTableSyncResult;

	invalidateColumns(): void;

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

			if ( opts.listKey !== listKey ) {
				listKey = opts.listKey;
				if ( selectionKeys( table ).length > 0 ) {
					table.clearSelection();
					result.selectionChanged = true;
					opts.onSelection?.( [] );
				}
			}

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
