import { __, _n, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import { restErrorFromResponse } from '../../src/core/api-client';
import { toastRestFailure } from '../../src/core/rest-failure';
import { beginTrashChange, projectTrash, trashKey, watchTrashChanges } from '../../src/desktop-files/trash-optimistic';
import { isMobileStamped } from '../../src/mode/stamp';
import { stackOnPhone } from '../../src/ui/components/os-table/stack-on-phone';

import '../../src/ui/components/os-table/os-table';
import { runEmptyLoop } from './parts/empty-loop';
import * as realtime from './parts/realtime';
import {
	buildColumns,
	mapRecycleTypeToFileType,
} from './parts/table-visuals';
import type {
	RecycleBinItem,
	RecycleBinItemRef,
	EmptyResponse,
	BulkResponse,
} from './parts/types';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import type { ViewContext } from '@openstation/app';

const APP_ID = 'desktop-mode-recycle-bin';

interface AppState extends Record< string, unknown > {
	filter: string;
	search: string;
}

interface AppData {
	items: RecycleBinItem[];
	total: number;
	mediaTrash: boolean;
}

type Ctx = ViewContext< AppState, AppData >;

interface UiState {

	selected: RecycleBinItemRef[];

	listKey: string;

	fingerprint: string;

	empty: { mode: 'idle' | 'starting' | 'progress'; purged: number; total: number };

	refreshTimer: number | null;

	lastArt: string;

	phoneColumns: boolean | null;
}

const freshUi = (): UiState => ( {
	selected: [],
	listKey: '',
	fingerprint: '',
	empty: { mode: 'idle', purged: 0, total: 0 },
	refreshTimer: null,
	lastArt: '',
	phoneColumns: null,
} );

function fingerprint( items: RecycleBinItem[] ): string {
	if ( items.length === 0 ) {
		return '';
	}
	return items
		.map( ( i ) => JSON.stringify( i ) )
		.sort()
		.join( '|' );
}

function emitChanged( kind: 'restore' | 'purge' | 'empty', ok: number ): void {
	const detail = { kind, ok, errors: [], source: 'local' as const };
	document.dispatchEvent( new CustomEvent( 'os-recycle-bin-changed', { detail } ) );
	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( 'openstation.recycleBin.changed', detail );
	}
}

const table = ( ctx: Ctx ): OsTable< RecycleBinItem > | null =>
	ctx.root.querySelector< OsTable< RecycleBinItem > >( '[data-os-trash-table]' );

function collectSelected( ctx: Ctx ): RecycleBinItemRef[] {
	const el = table( ctx );
	if ( ! el ) {
		return [];
	}
	const sel = new Set( Array.from( el.selection ?? [], String ) );
	const out: RecycleBinItemRef[] = [];
	for ( const row of el.visibleRows ?? [] ) {
		if ( sel.has( `${ row.type }:${ row.id }` ) ) {
			out.push( { id: row.id, type: row.type } );
		}
	}
	return out;
}

function clearSelection( ctx: Ctx ): void {
	table( ctx )?.clearSelection();
	ctx.ui( freshUi ).selected = [];
}

async function removeRefs( ctx: Ctx, refs: RecycleBinItemRef[], action: 'restore' | 'purge' ): Promise< void > {
	const operations = refs.flatMap( ( ref ) => {
		const row = ctx.data.items.find( ( item ) => trashKey( item ) === trashKey( ref ) );
		const operation = row && beginTrashChange( row, 'out' );
		return operation ? [ { ref, operation } ] : [];
	} );
	if ( operations.length === 0 ) {
		return;
	}
	clearSelection( ctx );
	try {
		const ok = await ctx.dispatch( action, { items: operations.map( ( entry ) => entry.ref ) } );
		const remaining = new Set( ctx.data.items.map( trashKey ) );
		let changed = 0;
		for ( const { ref, operation } of operations ) {
			const removed = ok && ! remaining.has( trashKey( ref ) );
			changed += Number( removed );
			void operation.finish( removed );
		}
		if ( changed > 0 ) {
			emitChanged( action, changed );
		}

		const kept = ok ? operations.length - changed : 0;
		if ( kept > 0 ) {
			ctx.host.toast?.( {
				message:
					action === 'restore'
						? sprintf(

							_n( '%d item could not be restored.', '%d items could not be restored.', kept ),
							kept,
						)
						: sprintf(

							_n( '%d item could not be deleted.', '%d items could not be deleted.', kept ),
							kept,
						),
				type: 'error',
			} );
		}
	} catch ( err ) {
		for ( const { operation } of operations ) {
			void operation.finish( false );
		}
		toastRestFailure( ctx.host.toast, err, {
			fallback:
				action === 'restore'
					? __( 'Could not restore the selected items.' )
					: __( 'Could not delete the selected items.' ),
		} );
	}
}

async function restoreRefs( ctx: Ctx, refs: RecycleBinItemRef[] ): Promise< void > {
	await removeRefs( ctx, refs, 'restore' );
}

async function purgeRefs( ctx: Ctx, refs: RecycleBinItemRef[] ): Promise< void > {
	if ( refs.length === 0 ) {
		return;
	}
	const confirmed = await ctx.host.confirm?.( {
		title: __( 'Delete forever?' ),
		message: sprintf(

			__( 'Permanently delete %d item(s)? This cannot be undone.' ),
			refs.length,
		),
		confirmLabel: __( 'Delete forever' ),
		danger: true,
	} );
	if ( confirmed ) {
		await removeRefs( ctx, refs, 'purge' );
	}
}

async function pinRefs( ctx: Ctx, refs: RecycleBinItemRef[] ): Promise< void > {
	if ( refs.length === 0 ) {
		return;
	}
	const filesApi = ( window.wp as {
		os?: { files?: { rest?: { createPlacement: ( body: unknown ) => Promise< unknown > } } };
	} | undefined )?.os?.files?.rest;
	clearSelection( ctx );
	const optimistic = refs.flatMap( ( ref ) => {
		const row = ctx.data.items.find( ( item ) => trashKey( item ) === trashKey( ref ) );
		const operation = row && beginTrashChange( row, 'out' );
		return operation ? [ operation ] : [];
	} );
	let placed = 0;
	let failedRestores = 0;
	let firstFailure: unknown;
	let restored = 0;
	for ( const ref of refs ) {
		let result: BulkResponse;
		try {
			const response = await ctx.fetch( 'desktop-mode/v1/recycle-bin/restore', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { items: [ ref ] } ),
			} );
			if ( ! response.ok ) {
				throw await restErrorFromResponse( response );
			}
			result = ( await response.json() ) as BulkResponse;
		} catch ( err ) {
			console.error( '[trash] pin-to-desktop restore failed', err );
			failedRestores += 1;
			firstFailure ??= err;
			continue;
		}
		if ( ! result.ok.includes( ref.id ) ) {
			continue;
		}
		restored += 1;
		const desktopType = mapRecycleTypeToFileType( ref.type );
		if ( ! filesApi || ! desktopType ) {
			continue;
		}
		try {
			await filesApi.createPlacement( {
				type: desktopType,
				ref: String( ref.id ),
				x: 16 + ( placed % 5 ) * 96,
				y: 16 + Math.floor( placed / 5 ) * 110,
			} );
		} catch ( err ) {
			console.error( '[trash] pin-to-desktop placement failed', err );
		}
		placed += 1;
	}
	emitChanged( 'restore', restored );
	if ( failedRestores > 0 ) {
		toastRestFailure( ctx.host.toast, firstFailure, {
			fallback: sprintf(

				_n( '%d item could not be restored.', '%d items could not be restored.', failedRestores ),
				failedRestores,
			),
		} );
	}
	try {
		await ctx.dispatch( 'refresh' );
	} finally {
		optimistic.forEach( ( operation ) => void operation.finish( false ) );
	}
}

async function emptyAll( ctx: Ctx ): Promise< void > {
	const confirmed = await ctx.host.confirm?.( {
		title: __( 'Empty Trash?' ),
		message: __(
			'Permanently delete ALL items in the Trash? This includes every type and any items hidden by the current filter or search. This cannot be undone.',
		),
		confirmLabel: __( 'Empty Trash' ),
		danger: true,
	} );
	if ( ! confirmed ) {
		return;
	}
	const ui = ctx.ui( freshUi );
	const optimistic = ctx.data.items.flatMap( ( item ) => {
		const operation = beginTrashChange( item, 'out' );
		return operation ? [ operation ] : [];
	} );
	ui.empty = { mode: 'starting', purged: 0, total: 0 };
	ctx.repaint();
	try {
		const loop = await runEmptyLoop( {
			emptyBin: async (): Promise< EmptyResponse > => {
				const response = await ctx.fetch( 'desktop-mode/v1/recycle-bin/empty', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{}',
				} );
				if ( ! response.ok ) {
					throw await restErrorFromResponse( response );
				}
				return ( await response.json() ) as EmptyResponse;
			},
			onProgress: ( { purged, initialTotal } ) => {
				ui.empty = { mode: 'progress', purged, total: initialTotal };
				ctx.repaint();
			},
		} );
		emitChanged( 'empty', loop.purged );
		if ( loop.skipped > 0 ) {
			ctx.host.toast?.( {
				message: sprintf(

					__( '%d item(s) skipped (insufficient permissions).' ),
					loop.skipped,
				),
			} );
		}
	} catch ( err ) {
		console.error( '[trash] empty failed', err );
		toastRestFailure( ctx.host.toast, err, { fallback: __( 'Could not empty the Recycle Bin.' ) } );
	} finally {
		ui.empty = { mode: 'idle', purged: 0, total: 0 };
		clearSelection( ctx );
		try {
			await ctx.dispatch( 'refresh' );
		} finally {
			optimistic.forEach( ( operation ) => void operation.finish( false ) );
			ctx.repaint();
		}
	}
}

function emptyButtonLabel( ui: UiState ): string {
	if ( ui.empty.mode === 'idle' ) {
		return __( 'Empty Trash' );
	}
	if ( ui.empty.mode === 'starting' || ui.empty.total === 0 ) {
		return __( 'Emptying…' );
	}
	return sprintf(

		__( 'Emptying… %1$d of %2$d' ),
		ui.empty.purged,
		ui.empty.total,
	);
}

function bulkActions( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	return html`
		<span class="os-recycle-bin__count">${ sprintf(

			__( '%d selected' ),
			ui.selected.length,
		) }</span>
		<os-button variant="secondary" @click=${ () => void restoreRefs( ctx, collectSelected( ctx ) ) }>
			<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>
			${ __( 'Restore' ) }
		</os-button>
		${ phone
			? ''
			: html`<os-button variant="secondary" @click=${ () => void pinRefs( ctx, collectSelected( ctx ) ) }>
				<span class="dashicons dashicons-desktop" aria-hidden="true"></span>
				${ __( 'Pin to desktop' ) }
			</os-button>` }
		<os-button variant="danger" @click=${ () => void purgeRefs( ctx, collectSelected( ctx ) ) }>
			<span class="dashicons dashicons-trash" aria-hidden="true"></span>
			${ __( 'Delete forever' ) }
		</os-button>
	`;
}

export default defineApp< AppState, AppData >( APP_ID, {
	view: ( ctx ) => {
		const { state, data } = ctx;
		const ui = ctx.ui( freshUi );
		const hasItems = projectTrash( data.items, data.total, state.filter, state.search ).total > 0 || ui.empty.mode !== 'idle';
		const emptying = ui.empty.mode !== 'idle';
		const phone = isMobileStamped();
		const selecting = ui.selected.length > 0;
		return html`
			<div class="desktop-mode-recycle-bin" data-os-recycle-bin-root>
				<header class="os-recycle-bin__toolbar" ?hidden=${ ! hasItems }>
					<div class="os-recycle-bin__toolbar-left">
						<os-segmented os-bind="filter" os-action="refresh" value=${ state.filter } label=${ __( 'Filter by type' ) }>
							<os-segment value="">${ __( 'All' ) }</os-segment>
							<os-segment value="post">${ __( 'Posts' ) }</os-segment>
							<os-segment value="page">${ __( 'Pages' ) }</os-segment>
							${ data.mediaTrash ? html`<os-segment value="attachment">${ __( 'Media' ) }</os-segment>` : '' }
							<os-segment value="comment">${ __( 'Comments' ) }</os-segment>
							<os-segment value="desktop">${ __( 'Desktop' ) }</os-segment>
						</os-segmented>
						<os-text-field
							type="search"
							label=${ __( 'Search trash' ) }
							hide-label
							os-bind="search"
							os-action="refresh"
							placeholder=${ __( 'Search trash…' ) }
						></os-text-field>
					</div>
					${ phone
						? ''
						: html`<div class="os-recycle-bin__toolbar-right" ?hidden=${ ! selecting }>
							${ bulkActions( ctx, ui, false ) }
						</div>` }
					<div class="os-recycle-bin__toolbar-trailing">
						<os-button variant="ghost" os-action="refresh" title=${ __( 'Refresh' ) }>
							<span class="dashicons dashicons-update" aria-hidden="true"></span>
						</os-button>
						<os-button
							variant="danger"
							?disabled=${ emptying }
							aria-busy=${ emptying ? 'true' : 'false' }
							@click=${ () => void emptyAll( ctx ) }
						>
							<span class="dashicons dashicons-trash" aria-hidden="true"></span>
							${ emptyButtonLabel( ui ) }
						</os-button>
					</div>
				</header>
				<div class="os-recycle-bin__body">
					<os-empty-state
						role="status"
						icon="trash"
						heading=${ __( 'The Trash is empty.' ) }
						description=${ __( 'Deleted posts, pages, and media show up here. Restoring puts them back where they were.' ) }
						?hidden=${ hasItems }
					></os-empty-state>
					<os-table
						data-os-trash-table
						os-preserve
						selectable="multi"
						sticky-header
						hover
						striped
						empty=${ __( 'No items match the current filter or search.' ) }
						?hidden=${ ! hasItems }
					></os-table>
				</div>
				${ phone && hasItems
					? html`<footer class="os-recycle-bin__bulk" ?hidden=${ ! selecting }>
						${ bulkActions( ctx, ui, true ) }
					</footer>`
					: '' }
			</div>
		`;
	},

	mounted: ( ctx ) => {
		realtime.start();

		void ctx.dispatch( 'refresh' );
		let refreshing: Promise< unknown > | null = null;
		const unwatch = watchTrashChanges( () => ctx.repaint(), () => {
			refreshing ??= Promise.resolve().then( () => {
				refreshing = null;
				return ctx.dispatch( 'refresh' );
			} );
			return refreshing;
		} );
		const ui = ctx.ui( freshUi );
		const onExternalChange = ( e: Event ): void => {
			const detail = ( e as CustomEvent< { source?: string } > ).detail;

			if ( ! detail?.source || detail.source === 'local' ) {
				return;
			}
			if ( ui.refreshTimer !== null ) {
				window.clearTimeout( ui.refreshTimer );
			}
			ui.refreshTimer = window.setTimeout( () => {
				ui.refreshTimer = null;
				void ctx.dispatch( 'refresh' );
			}, 200 );
		};
		document.addEventListener( 'os-recycle-bin-changed', onExternalChange );

		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			unwatch();
			realtime.stop();
			document.removeEventListener( 'os-recycle-bin-changed', onExternalChange );
			document.removeEventListener( 'os-mode-changed', onModeChange );
			if ( ui.refreshTimer !== null ) {
				window.clearTimeout( ui.refreshTimer );
			}
		};
	},

	updated: ( ctx ) => {
		const el = table( ctx );
		if ( ! el ) {
			return;
		}
		const ui = ctx.ui( freshUi );

		const phone = stackOnPhone( el );
		if ( phone !== ui.phoneColumns ) {
			ui.phoneColumns = phone;
			el.columns = buildColumns(
				{
					onRestore: ( ref ) => void restoreRefs( ctx, [ ref ] ),
					onPurge: ( ref ) => void purgeRefs( ctx, [ ref ] ),
				},
				{ phone },
			);
		}

		if ( ! el.hasAttribute( 'data-os-trash-wired' ) ) {
			el.setAttribute( 'data-os-trash-wired', '' );
			el.getRowId = ( row ) => `${ row.type }:${ row.id }`;
			el.sort = { key: 'deleted_at', direction: 'desc' };
			el.addEventListener( 'os-table-selection-change', () => {
				ui.selected = collectSelected( ctx );
				ctx.repaint();
			} );
		}

		const listKey = `${ ctx.state.filter }|${ ctx.state.search }`;
		if ( listKey !== ui.listKey ) {
			ui.listKey = listKey;
			if ( ( el.selection?.size ?? 0 ) > 0 ) {
				el.clearSelection();
			}
			ui.selected = [];
		}

		const projected = projectTrash( ctx.data.items, ctx.data.total, ctx.state.filter, ctx.state.search );
		const next = fingerprint( projected.items );
		if ( next !== ui.fingerprint ) {
			ui.fingerprint = next;
			el.data = projected.items;

			const visible = new Set(
				( el.visibleRows ?? [] ).map( ( row ) => `${ row.type }:${ row.id }` ),
			);
			const kept = Array.from( el.selection ?? [], String ).filter( ( key ) =>
				visible.has( key ),
			);
			if ( kept.length !== ( el.selection?.size ?? 0 ) ) {
				el.selection = kept;
				ui.selected = collectSelected( ctx );
			}
		}

		const art = String( ctx.extra[ projected.total > 0 ? 'full' : 'empty' ] ?? '' );
		if ( art && art !== ui.lastArt ) {
			ui.lastArt = art;
			ctx.host.setIcon?.( APP_ID, art );
		}
	},
} );
