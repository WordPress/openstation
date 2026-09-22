/**
 * Trash — the client view of the Recycle Bin app.
 *
 * The 1:1 rebuild of the legacy bin window's body, which it replaced
 * whole: same toolbar, same `<os-table>` painted through the cell
 * renderers (`parts/table-visuals.ts`), same empty state, same
 * confirm copy, same real-time channels. What the
 * framework absorbed from the old implementation: the REST client
 * and its config blob (actions + `data()` + `ctx.fetch`), the
 * fingerprint/cache/sequence choreography (data rides every dispatch
 * response), the loading skeleton (the first paint already has
 * data), the broadcast subscriptions (`watch( '*' )`), and the
 * hand-built toolbar wiring (the view is a function of state).
 *
 * The chunked Empty Trash loop is `parts/empty-loop.ts` over
 * `ctx.fetch` against the store's REST route, and the
 * chromeless-postMessage + Heartbeat real-time channels are
 * `parts/realtime.ts`. The one piece of the bin that is NOT the
 * app's is the closed tile's art — `src/desktop-files/
 * recycle-bin-icon-state.ts` — because it has to paint from the
 * always-on shell bundle before this script ever loads.
 *
 * @public
 */

import { __, _n, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import { restErrorFromResponse } from '../../src/core/api-client';
import { toastRestFailure } from '../../src/core/rest-failure';
import { beginTrashChange, projectTrash, trashKey, watchTrashChanges } from '../../src/desktop-files/trash-optimistic';
import { isMobileStamped } from '../../src/mode/stamp';
import { stackOnPhone } from '../../src/ui/components/os-table/stack-on-phone';
// Register before updated() assigns data and columns. A type-only import
// leaves own properties on an unupgraded element, shadowing the table's
// setters when the lazy component kit eventually loads.
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

/**
 * The app id — the legacy native window's FROZEN identifier (see
 * AGENTS.md), claimed by the app so shortcuts, dock placements,
 * drag-to-trash targets and theme slots keep working unchanged.
 */
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

/** Client-only per-window state — none of it may reach the server. */
interface UiState {
	/** The selected rows, resolved to typed refs on every change. */
	selected: RecycleBinItemRef[];
	/** filter|search identity — a change clears the selection. */
	listKey: string;
	/** Change-detection key so identical data skips the table repaint. */
	fingerprint: string;
	/** Empty Trash progress, painted into the button label. */
	empty: { mode: 'idle' | 'starting' | 'progress'; purged: number; total: number };
	/** External-change debounce timer. */
	refreshTimer: number | null;
	/** The tile art last pushed to the rails — swap only on change. */
	lastArt: string;
	/** Whether the columns were last built for a phone (`null`: not yet). */
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

/**
 * Stable key for change detection — identical state across two
 * fetches yields the same key, so the `<os-table>` body repaint can
 * be skipped. Same shape as the legacy fingerprint.
 */
function fingerprint( items: RecycleBinItem[] ): string {
	if ( items.length === 0 ) {
		return '';
	}
	return items
		.map( ( i ) => JSON.stringify( i ) )
		.sort()
		.join( '|' );
}

/**
 * Notify parity listeners that a bin operation finished — the same
 * document CustomEvent + hook the legacy bin emits. The cross-window
 * `os.<type>.changed` broadcasts are the SERVER action's job
 * (`$os->announce()`), so they are not re-emitted here.
 */
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

/** Resolve the table's selection to typed refs against VISIBLE rows. */
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

/** Remove rows immediately; the dispatch response restores any failed refs. */
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
		// A refused dispatch already toasted from the runtime. A dispatch
		// that went through but left rows behind is the server skipping
		// items it would not touch; the rows slid back, say why.
		const kept = ok ? operations.length - changed : 0;
		if ( kept > 0 ) {
			ctx.host.toast?.( {
				message:
					action === 'restore'
						? sprintf(
							/* translators: %d: number of items. */
							_n( '%d item could not be restored.', '%d items could not be restored.', kept ),
							kept,
						)
						: sprintf(
							/* translators: %d: number of items. */
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
			/* translators: %d: row count. */
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

/**
 * Restore first (per ref, so a mixed post-#5 + comment-#5 selection
 * keeps its success signals unambiguous — same reasoning as the
 * legacy bin), then place each on the desktop at staggered
 * coordinates matching `src/desktop-files/grid.ts`.
 */
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
			// eslint-disable-next-line no-console
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
			// eslint-disable-next-line no-console
			console.error( '[trash] pin-to-desktop placement failed', err );
		}
		placed += 1;
	}
	emitChanged( 'restore', restored );
	if ( failedRestores > 0 ) {
		toastRestFailure( ctx.host.toast, firstFailure, {
			fallback: sprintf(
				/* translators: %d: number of items. */
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

/**
 * Empty the whole bin: the same chunk-loop driver the legacy bin
 * runs (the server purges one chunk per call to dodge PHP timeouts),
 * over `ctx.fetch` against the legacy REST route, with the progress
 * painted into the button label declaratively.
 */
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
					/* translators: %d: skipped count. */
					__( '%d item(s) skipped (insufficient permissions).' ),
					loop.skipped,
				),
			} );
		}
	} catch ( err ) {
		// eslint-disable-next-line no-console
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
		/* translators: 1: items purged so far, 2: items in bin when emptying began. */
		__( 'Emptying… %1$d of %2$d' ),
		ui.empty.purged,
		ui.empty.total,
	);
}

/**
 * The selection's actions: the count, Restore, Pin to desktop and
 * Delete forever. In the toolbar on a desk; on a phone the same
 * controls are a bar along the bottom of the window, where the
 * thumb is, and Pin to desktop is not offered — a phone has no
 * desktop to pin to.
 */
function bulkActions( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	return html`
		<span class="os-recycle-bin__count">${ sprintf(
			/* translators: %d: selected row count. */
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
		// The chromeless-postMessage fast path + the Heartbeat
		// catch-all — the SAME channels the legacy bin subscribes,
		// reused wholesale. `watch( '*' )` covers the in-shell
		// broadcasts; these cover trash actions inside chromeless
		// iframes and other tabs.
		realtime.start();
		// The first mount may be a hover-prewarmed snapshot from before
		// a deletion. Reconcile after subscribing so that snapshot cannot
		// leave a newly opened bin empty until the next notification.
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
			// Local operations already refresh through their own
			// dispatch; only external sources re-fetch, debounced so a
			// bulk trash of 50 items lands as one repaint.
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
		// The view reads the shell's mode stamp (the bulk bar's place,
		// the cards); a crossing between the desk and the phone band
		// is the one change that repaints nothing on its own.
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
		// A card per row on a phone (`stack-on-phone.ts`), and the
		// columns built for it: labelled row buttons, a title that may
		// take two lines. Rebuilt only when the answer changes.
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
		// One-time wiring: composite row identity (post #5 and comment
		// #5 coexist), default sort, and the selection listener that
		// repaints the bulk bar.
		if ( ! el.hasAttribute( 'data-os-trash-wired' ) ) {
			el.setAttribute( 'data-os-trash-wired', '' );
			el.getRowId = ( row ) => `${ row.type }:${ row.id }`;
			el.sort = { key: 'deleted_at', direction: 'desc' };
			el.addEventListener( 'os-table-selection-change', () => {
				ui.selected = collectSelected( ctx );
				ctx.repaint();
			} );
		}
		// A filter/search change replaces the result set wholesale —
		// ids picked under the previous view must not linger invisibly.
		const listKey = `${ ctx.state.filter }|${ ctx.state.search }`;
		if ( listKey !== ui.listKey ) {
			ui.listKey = listKey;
			if ( ( el.selection?.size ?? 0 ) > 0 ) {
				el.clearSelection();
			}
			ui.selected = [];
		}
		// Assign the data only when it actually changed — same
		// fingerprint guard the legacy bin uses to skip body repaints.
		const projected = projectTrash( ctx.data.items, ctx.data.total, ctx.state.filter, ctx.state.search );
		const next = fingerprint( projected.items );
		if ( next !== ui.fingerprint ) {
			ui.fingerprint = next;
			el.data = projected.items;
			// Prune selection keys whose row left the visible list, so
			// the bulk bar's count stays truthful.
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
		// State-driven tile art, the legacy bin's signature move: the
		// tile draws the FULL bin while the trash holds anything, the
		// empty one otherwise. Both drawings shipped in the config
		// extra (App::config()), so crossing zero is a local swap.
		// Deliberately no count badge — a number on the tile reads as
		// update notifications.
		const art = String( ctx.extra[ projected.total > 0 ? 'full' : 'empty' ] ?? '' );
		if ( art && art !== ui.lastArt ) {
			ui.lastArt = art;
			ctx.host.setIcon?.( APP_ID, art );
		}
	},
} );
