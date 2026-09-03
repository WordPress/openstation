/**
 * Plugins app — the Installed tab's table.
 *
 * Part of the `desktop-mode-plugins` client view. The `<os-table>`
 * lives under `os-preserve` in the view and is driven from
 * `updated()` through {@link syncInstalledTable}: columns (icon +
 * name, status, version with the update badge, author, size, the
 * "Automatic Updates" column when the site allows it, actions), the
 * expandable detail panel, selection → bulk bar, and the phone
 * layout (a card per row, fewer columns, bulk bar at the bottom).
 * The mutations that stay client-side — Core's update and
 * auto-update-toggle handlers — are here too; activate / deactivate /
 * delete are `mutations.ts`.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import type { OsTable, OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import { stackOnPhone } from '../../../src/ui/components/os-table/stack-on-phone';
import { formatSize } from './html';
import { attachIconFallback } from './icon-fallback';
import { buildInstalledDetail } from './installed-detail';
import {
	activatePlugin,
	deactivatePlugin,
	deletePlugin,
	leaveAfterSelfMutation,
	selfGone,
} from './mutations';
import { enqueueUpdateJob } from './update-queue';
import {
	describeError,
	isActiveStatus,
	stripHtml,
	type InstalledPlugin,
	type PluginsHost,
} from './types';
import '../../../src/ui/components/os-badge/os-badge';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-table/os-table';

/**
 * The columns a phone shows — a card per row there (`<os-table
 * stacked>`), so the version and the author are labelled lines under
 * the name rather than widths to find. The size and the auto-update
 * switch stay in the row's detail panel.
 */
const MOBILE_COLUMN_KEYS = new Set< string >( [ 'name', 'status', 'version', 'author', '_actions' ] );

/** Client-only state of the Installed tab. */
export interface InstalledUi {
	/** Selected plugin paths, resolved on every selection change. */
	selected: string[];
	/** Rows in the update queue (enqueued or in flight) — the Update button disables. */
	updating: Set< string >;
	/** Rows whose auto-update toggle is in flight — the cell paints a spinner. */
	autoUpdating: Set< string >;
	/** Status painted before the server answers, keyed by plugin path. */
	optimistic: Map< string, InstalledPlugin[ 'status' ] >;
	/** Whether the columns were last built for a phone (`null`: not yet). */
	phoneColumns: boolean | null;
	/** Change-detection key of the last `data` assignment. */
	fingerprint: string;
	/** status|search identity — a change clears the selection. */
	listKey: string;
}

export const freshInstalledUi = (): InstalledUi => ( {
	selected: [],
	updating: new Set(),
	autoUpdating: new Set(),
	optimistic: new Map(),
	phoneColumns: null,
	fingerprint: '',
	listKey: '',
} );

/** The rows the current status segment + search leave visible. */
export function filterRows( rows: InstalledPlugin[], status: string, search: string ): InstalledPlugin[] {
	const q = search.trim().toLowerCase();
	return rows.filter( ( row ) => {
		if ( status === 'active' && ! isActiveStatus( row.status ) ) {
			return false;
		}
		if ( status === 'inactive' && row.status !== 'inactive' ) {
			return false;
		}
		if ( status === 'update' && ! row.openstation_update_available?.available ) {
			return false;
		}
		if ( q !== '' ) {
			const haystack = `${ row.name ?? '' } ${ row.plugin } ${ stripHtml( row.author ?? '' ) }`.toLowerCase();
			if ( ! haystack.includes( q ) ) {
				return false;
			}
		}
		return true;
	} );
}

/** Rows with a pending update — the badge on the "Update available" segment. */
export function countUpdates( rows: InstalledPlugin[] ): number {
	return rows.filter( ( r ) => !! r.openstation_update_available?.available ).length;
}

/**
 * Drive the `<os-table>` after a paint: build the columns for the
 * device, wire it once, clear a stale selection when the view
 * changed, and assign the visible rows when anything they paint
 * from changed.
 */
export function syncInstalledTable( el: OsTable< InstalledPlugin >, host: PluginsHost, ui: InstalledUi, view: {
	status: string;
	search: string;
} ): void {
	const phone = stackOnPhone( el );
	if ( phone !== ui.phoneColumns ) {
		ui.phoneColumns = phone;
		el.columns = buildColumns( host, ui, phone );
	}
	if ( ! el.hasAttribute( 'data-os-plugins-wired' ) ) {
		el.setAttribute( 'data-os-plugins-wired', '' );
		el.getRowId = ( row, index ) => row.plugin || String( index );
		// Every row expands into the rich detail panel; the action
		// buttons carry `data-noclick` so they stay independent.
		el.subTable = ( row ) => buildInstalledDetail( row, host.rest );
		el.addEventListener( 'os-table-row-click', ( ev: Event ) => {
			const detail = ( ev as CustomEvent< { index: number } > ).detail;
			if ( ! detail ) {
				return;
			}
			if ( el.isExpanded( detail.index ) ) {
				el.collapse( detail.index );
			} else {
				el.expand( detail.index );
			}
		} );
		el.addEventListener( 'os-table-selection-change', () => {
			ui.selected = Array.from( el.selection ?? [], String );
			host.repaint();
		} );
	}
	// A filter or search change replaces the result set — a plugin
	// ticked under the previous view must not ride silently into the
	// next bulk action (bulk Delete included).
	const listKey = `${ view.status }|${ view.search }`;
	if ( listKey !== ui.listKey ) {
		ui.listKey = listKey;
		if ( ( el.selection?.size ?? 0 ) > 0 ) {
			el.clearSelection();
		}
		ui.selected = [];
	}
	const rows = filterRows( host.installed, view.status, view.search ).map( ( row ) =>
		ui.optimistic.has( row.plugin ) ? { ...row, status: ui.optimistic.get( row.plugin )! } : row,
	);
	const next = fingerprint( rows, ui );
	if ( next !== ui.fingerprint ) {
		ui.fingerprint = next;
		el.data = rows;
		// Prune selection keys whose row left the visible list.
		const visible = new Set( rows.map( ( r ) => r.plugin ) );
		const kept = Array.from( el.selection ?? [], String ).filter( ( key ) => visible.has( key ) );
		if ( kept.length !== ( el.selection?.size ?? 0 ) ) {
			el.selection = kept;
			ui.selected = kept;
		}
	}
}

function fingerprint( rows: InstalledPlugin[], ui: InstalledUi ): string {
	const body = rows
		.map(
			( r ) =>
				`${ r.plugin }:${ r.status }:${ r.version ?? '' }:${ r.openstation_update_available?.available ? r.openstation_update_available.new_version : '' }:${ r.openstation_auto_update?.enabled ? 1 : 0 }`,
		)
		.join( '|' );
	return `${ body }#${ Array.from( ui.updating ).join( ',' ) }#${ Array.from( ui.autoUpdating ).join( ',' ) }`;
}

// ─── Columns ───────────────────────────────────────────────────────

export function buildColumns( host: PluginsHost, ui: InstalledUi, phone: boolean ): OsTableColumn< InstalledPlugin >[] {
	const { caps, autoUpdatesEnabled } = host.extra;
	const cols: OsTableColumn< InstalledPlugin >[] = [
		{ key: 'name', label: __( 'Plugin', 'desktop-mode' ), sortable: true, sticky: true, render: ( _v, row ) => renderNameCell( row ) },
		{ key: 'status', label: __( 'Status', 'desktop-mode' ), sortable: true, render: ( _v, row ) => renderStatusCell( row ) },
		{ key: 'version', label: __( 'Version', 'desktop-mode' ), sortable: true, render: ( _v, row ) => renderVersionCell( row ) },
		{ key: 'author', label: __( 'Author', 'desktop-mode' ), render: ( _v, row ) => renderAuthorCell( row ) },
		{
			key: 'openstation_size_kb',
			label: __( 'Size', 'desktop-mode' ),
			align: 'end',
			sortable: true,
			sortValue: ( row ) => row.openstation_size_kb ?? 0,
			render: ( _v, row ) => formatSize( row.openstation_size_kb ?? null ),
		},
	];
	// Mirrors Core's `WP_Plugins_List_Table::$show_autoupdates` gate.
	if ( autoUpdatesEnabled ) {
		cols.push( {
			key: 'auto_updates',
			label: __( 'Automatic Updates', 'desktop-mode' ),
			sortable: true,
			sortValue: ( row ) => ( row.openstation_auto_update?.enabled ? 1 : 0 ),
			render: ( _v, row ) => renderAutoUpdateCell( host, ui, row ),
		} );
	}
	if ( caps.activate || caps.delete ) {
		cols.push( { key: '_actions', label: '', align: 'end', render: ( _v, row ) => renderActionsCell( host, ui, row ) } );
	}
	// A phone shows which plugin, whether it is on, and what can be done
	// to it; the rest is a tap away in the detail panel.
	return phone ? cols.filter( ( col ) => MOBILE_COLUMN_KEYS.has( col.key ) ) : cols;
}

// Cells use INLINE styles — `<os-table>` renders into its shadow DOM,
// which document stylesheets never reach.

function renderNameCell( row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:0;padding:4px 0;';
	const icon = document.createElement( 'div' );
	icon.style.cssText =
		'flex:0 0 32px;width:32px;height:32px;max-width:32px;max-height:32px;' +
		'border-radius:6px;overflow:hidden;display:flex;align-items:center;' +
		'justify-content:center;background:rgba(0,0,0,0.04);box-sizing:border-box;';
	const url = row.openstation_icon_url;
	if ( url ) {
		const img = document.createElement( 'img' );
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.style.cssText = 'width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;display:block;';
		img.src = attachIconFallback( img, url, () => {
			icon.replaceChildren( buildFallbackIcon() );
		} );
		icon.appendChild( img );
	} else {
		icon.appendChild( buildFallbackIcon() );
	}
	const text = document.createElement( 'div' );
	text.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;line-height:1.35;';
	const title = document.createElement( 'strong' );
	title.textContent = row.name || row.plugin;
	title.style.cssText = 'display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
	const path = document.createElement( 'span' );
	path.textContent = row.plugin;
	path.style.cssText =
		'display:block;font-size:0.78em;color:#888;font-family:' +
		'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
		'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
	text.append( title, path );
	wrap.append( icon, text );
	return wrap;
}

function buildFallbackIcon(): HTMLElement {
	const fallback = document.createElement( 'span' );
	fallback.className = 'dashicons dashicons-admin-plugins';
	fallback.setAttribute( 'aria-hidden', 'true' );
	fallback.style.cssText = 'font-size:18px;width:18px;height:18px;line-height:18px;color:#888;';
	return fallback;
}

function renderStatusCell( row: InstalledPlugin ): HTMLElement {
	const badge = document.createElement( 'span' );
	const isActive = isActiveStatus( row.status );
	const dot = isActive ? '#16a34a' : '#9ca3af';
	const bg = isActive ? 'rgba(22, 163, 74, 0.14)' : 'rgba(120, 120, 120, 0.12)';
	const fg = isActive ? '#166e37' : '#555';
	badge.style.cssText =
		'display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 8px;' +
		'border-radius:999px;font-size:0.78em;font-weight:600;line-height:1.4;' +
		`white-space:nowrap;background:${ bg };color:${ fg };`;
	const dotEl = document.createElement( 'span' );
	dotEl.style.cssText = `width:6px;height:6px;border-radius:50%;background:${ dot };flex:0 0 auto;display:inline-block;`;
	const label = document.createElement( 'span' );
	label.textContent = isActive ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' );
	badge.append( dotEl, label );
	return badge;
}

function renderVersionCell( row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
	const v = document.createElement( 'span' );
	v.textContent = row.version ?? '—';
	wrap.appendChild( v );
	const update = row.openstation_update_available;
	if ( update?.available && update.new_version ) {
		const badge = document.createElement( 'span' );
		badge.style.cssText =
			'font-size:0.78em;background:rgba(245,175,0,0.18);color:#915f00;padding:1px 7px;border-radius:999px;font-weight:600;';
		badge.textContent = sprintf(
			/* translators: %s: new plugin version */
			__( '→ %s', 'desktop-mode' ),
			update.new_version,
		);
		wrap.appendChild( badge );
	}
	return wrap;
}

function renderAuthorCell( row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;';
	wrap.textContent = stripHtml( row.author ?? '' ) || __( 'Unknown', 'desktop-mode' );
	return wrap;
}

/**
 * Core's three-state "Automatic Updates" cell: a read-only label when
 * a filter pinned the state, an em-dash when the plugin never checks
 * in with wp.org, a toggle link otherwise (a spinner while in flight).
 */
function renderAutoUpdateCell( host: PluginsHost, ui: InstalledUi, row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'data-noclick', '' );
	wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;';
	const meta = row.openstation_auto_update;
	const forced = meta?.forced ?? null;
	if ( forced !== null ) {
		const label = document.createElement( 'span' );
		label.style.cssText = 'color:var(--os-ui-fg-muted,#50575e);';
		label.textContent = forced
			? __( 'Auto-updates enabled', 'desktop-mode' )
			: __( 'Auto-updates disabled', 'desktop-mode' );
		wrap.appendChild( label );
		return wrap;
	}
	if ( ! meta?.supported ) {
		const placeholder = document.createElement( 'span' );
		placeholder.style.cssText = 'color:var(--os-ui-fg-faint,#787c82);';
		placeholder.textContent = '—';
		placeholder.title = __(
			'This plugin does not check in with WordPress.org, so automatic updates can\'t be scheduled.',
			'desktop-mode',
		);
		wrap.appendChild( placeholder );
		return wrap;
	}
	const enabled = !! meta.enabled;
	const busy = ui.autoUpdating.has( row.plugin );
	const link = document.createElement( 'a' );
	link.href = '#';
	link.setAttribute( 'role', 'button' );
	link.setAttribute( 'data-wp-action', enabled ? 'disable' : 'enable' );
	link.style.cssText =
		'display:inline-flex;align-items:center;gap:6px;color:var( --os-ui-accent, #2271b1 );text-decoration:none;cursor:pointer;font-size:0.9em;';
	if ( busy ) {
		link.style.opacity = '0.6';
		link.style.pointerEvents = 'none';
		link.setAttribute( 'aria-busy', 'true' );
	}
	const label = document.createElement( 'span' );
	if ( busy ) {
		label.textContent = enabled ? __( 'Disabling…', 'desktop-mode' ) : __( 'Enabling…', 'desktop-mode' );
	} else {
		label.textContent = enabled
			? __( 'Disable auto-updates', 'desktop-mode' )
			: __( 'Enable auto-updates', 'desktop-mode' );
	}
	link.appendChild( label );
	link.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		void runToggleAutoUpdate( host, ui, row );
	} );
	wrap.appendChild( link );
	return wrap;
}

function renderActionsCell( host: PluginsHost, ui: InstalledUi, row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = 'display:inline-flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:nowrap;';
	wrap.setAttribute( 'data-noclick', '' );
	const can = row.openstation_can_manage ?? {
		activate: row.status === 'inactive',
		deactivate: isActiveStatus( row.status ),
		delete: row.status === 'inactive',
	};
	// Core's inline "Update now" link: gated by `update_plugins` and a
	// `package` URL; without the package, Core's "unavailable" hint.
	const update = row.openstation_update_available;
	if ( host.extra.caps.update && update?.available ) {
		if ( update.package ) {
			const updating = ui.updating.has( row.plugin );
			const btn = button(
				updating
					? __( 'Updating…', 'desktop-mode' )
					: sprintf(
						/* translators: %s: new plugin version (e.g. "1.4.2") */
						__( 'Update to %s', 'desktop-mode' ),
						update.new_version ?? '',
					),
				'primary',
			);
			if ( updating ) {
				btn.setAttribute( 'disabled', '' );
				btn.setAttribute( 'aria-busy', 'true' );
			}
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void runUpdate( host, ui, row );
			} );
			wrap.appendChild( btn );
		} else {
			const hint = document.createElement( 'span' );
			hint.style.cssText = 'font-size:0.78em;color:var(--os-ui-fg-muted,#50575e);';
			hint.textContent = __( 'Auto-update unavailable', 'desktop-mode' );
			hint.title = __(
				'This plugin does not ship a wp.org download package. Update it manually from its source.',
				'desktop-mode',
			);
			wrap.appendChild( hint );
		}
	}
	if ( can.activate ) {
		const btn = button( __( 'Activate', 'desktop-mode' ), 'primary' );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void runOptimistic( host, ui, row, 'active', () => activatePlugin( host, row ) );
		} );
		wrap.appendChild( btn );
	} else if ( can.deactivate ) {
		const btn = button( __( 'Deactivate', 'desktop-mode' ), 'secondary' );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void runOptimistic( host, ui, row, 'inactive', () => deactivatePlugin( host, row ) );
		} );
		wrap.appendChild( btn );
	}
	if ( can.delete ) {
		const btn = button( __( 'Delete', 'desktop-mode' ), 'danger' );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void deletePlugin( host, row );
		} );
		wrap.appendChild( btn );
	}
	return wrap;
}

function button( label: string, variant: string ): HTMLElement {
	const b = document.createElement( 'os-button' );
	b.setAttribute( 'variant', variant );
	b.setAttribute( 'size', 'small' );
	b.textContent = label;
	return b;
}

// ─── Runners ───────────────────────────────────────────────────────

/** Paint the new status now, let the dispatch confirm or revert it. */
async function runOptimistic(
	host: PluginsHost,
	ui: InstalledUi,
	row: InstalledPlugin,
	next: InstalledPlugin[ 'status' ],
	run: () => Promise< boolean >,
): Promise< void > {
	ui.optimistic.set( row.plugin, next );
	host.repaint();
	try {
		await run();
	} finally {
		ui.optimistic.delete( row.plugin );
		host.repaint();
	}
}

/**
 * Update one plugin via Core's `wp_ajax_update_plugin`, serialised
 * through the single-flight queue (concurrent upgrader runs corrupt
 * the `update_plugins` transient). Core signals "already at the latest
 * version" only through its translated message (and an `errorCode`
 * should it ever ship one) — converge the row to the truth either way.
 */
export async function runUpdate( host: PluginsHost, ui: InstalledUi, row: InstalledPlugin ): Promise< void > {
	if ( ui.updating.has( row.plugin ) ) {
		return;
	}
	ui.updating.add( row.plugin );
	host.repaint();
	try {
		const result = await enqueueUpdateJob( () => host.rest.updateInstalledPlugin( row ) );
		host.toast(
			sprintf(
				/* translators: 1: plugin name, 2: new version */
				__( '%1$s updated to %2$s.', 'desktop-mode' ),
				row.name || row.plugin,
				result.newVersion,
			),
		);
		host.broadcastChange( { plugin: row.plugin, action: 'update' } );
	} catch ( err ) {
		const errCode = ( err as { code?: string } )?.code;
		const errMessage = ( err as { message?: string } )?.message;
		const coreUpToDateMessage = window.wp?.i18n?.__?.( 'The plugin is at the latest version.' );
		const isUpToDate =
			errCode === 'up_to_date' || ( !! coreUpToDateMessage && errMessage === coreUpToDateMessage );
		if ( isUpToDate ) {
			host.toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s is already up to date.', 'desktop-mode' ),
					row.name || row.plugin,
				),
			);
			host.broadcastChange( { plugin: row.plugin, action: 'update' } );
		} else {
			host.toast(
				sprintf(
					/* translators: 1: plugin name, 2: error message */
					__( 'Update of %1$s failed: %2$s', 'desktop-mode' ),
					row.name || row.plugin,
					describeError( err ),
				),
				6000,
			);
		}
	} finally {
		ui.updating.delete( row.plugin );
		// Reconcile from the server either way: the upgrader may have
		// committed on disk even when the promise rejected, and Core's
		// `wp_update_plugins()` may have moved the transient even on
		// failure — so the row AND the dock badge re-read the truth.
		void host.refresh();
		void host.rest.refreshFrameworkMenu();
	}
}

/**
 * Flip the per-plugin auto-update state via Core's `toggle-auto-updates`
 * handler, then re-read the row.
 */
export async function runToggleAutoUpdate( host: PluginsHost, ui: InstalledUi, row: InstalledPlugin ): Promise< void > {
	const meta = row.openstation_auto_update;
	if ( ui.autoUpdating.has( row.plugin ) || ! meta || meta.forced !== null || ! meta.supported ) {
		return;
	}
	const wasEnabled = meta.enabled;
	ui.autoUpdating.add( row.plugin );
	host.repaint();
	try {
		await host.rest.toggleAutoUpdate( row, wasEnabled ? 'disable' : 'enable' );
		host.toast(
			sprintf(
				wasEnabled
					? /* translators: %s: plugin name */ __( 'Auto-updates disabled for %s.', 'desktop-mode' )
					: /* translators: %s: plugin name */ __( 'Auto-updates enabled for %s.', 'desktop-mode' ),
				row.name || row.plugin,
			),
		);
		host.broadcastChange( { plugin: row.plugin, action: 'auto-update' } );
		await host.refresh();
	} catch ( err ) {
		host.toast(
			sprintf(
				/* translators: 1: plugin name, 2: error message */
				__( 'Could not toggle auto-updates for %1$s: %2$s', 'desktop-mode' ),
				row.name || row.plugin,
				describeError( err ),
			),
			6000,
		);
	} finally {
		ui.autoUpdating.delete( row.plugin );
		host.repaint();
	}
}

/** One bulk button of the selection bar. */
export interface BulkButton {
	label: string;
	variant: 'primary' | 'secondary' | 'danger';
	run: () => void;
}

/** The buttons the current selection offers. */
export function bulkButtons( host: PluginsHost, ui: InstalledUi, table: () => OsTable< InstalledPlugin > | null ): BulkButton[] {
	const { caps } = host.extra;
	const selected = host.installed.filter( ( r ) => ui.selected.includes( r.plugin ) );
	const out: BulkButton[] = [];
	const clear = (): void => {
		table()?.clearSelection();
		ui.selected = [];
	};
	if ( caps.update ) {
		const updatable = selected.filter(
			( r ) => !! r.openstation_update_available?.available && !! r.openstation_update_available.package,
		);
		if ( updatable.length > 0 ) {
			out.push( {
				label: sprintf(
					/* translators: %d: number of plugins with pending updates */
					__( 'Update %d', 'desktop-mode' ),
					updatable.length,
				),
				variant: 'primary',
				run: () => void runBulkUpdate( host, ui, updatable ).then( clear ),
			} );
		}
	}
	if ( caps.activate ) {
		const activatable = selected.filter( ( r ) => r.status === 'inactive' );
		if ( activatable.length > 0 ) {
			out.push( {
				label: __( 'Activate', 'desktop-mode' ),
				variant: 'primary',
				run: () => void runBulk( host, activatable, 'activate' ).then( clear ),
			} );
		}
		const deactivatable = selected.filter( ( r ) => isActiveStatus( r.status ) );
		if ( deactivatable.length > 0 ) {
			out.push( {
				label: __( 'Deactivate', 'desktop-mode' ),
				variant: 'secondary',
				run: () => void runBulk( host, deactivatable, 'deactivate' ).then( clear ),
			} );
		}
	}
	if ( caps.delete ) {
		const deletable = selected.filter( ( r ) => r.status === 'inactive' );
		if ( deletable.length > 0 ) {
			out.push( {
				label: __( 'Delete', 'desktop-mode' ),
				variant: 'danger',
				run: () => void runBulk( host, deletable, 'delete' ).then( clear ),
			} );
		}
	}
	return out;
}

/** Activate / deactivate / delete the selection in one dispatch. */
async function runBulk( host: PluginsHost, rows: InstalledPlugin[], verb: 'activate' | 'deactivate' | 'delete' ): Promise< void > {
	const plugins = rows.map( ( r ) => r.plugin );
	const ok = await host.dispatch(
		'bulk',
		{ plugins, do: verb },
		verb === 'delete'
			? {
				confirm: {
					title: __( 'Delete selected plugins?', 'desktop-mode' ),
					message: sprintf(
						/* translators: %d: number of plugins */
						__( 'Permanently delete %d plugin(s)? Their files will be removed from disk. This cannot be undone.', 'desktop-mode' ),
						rows.length,
					),
					label: __( 'Delete', 'desktop-mode' ),
					danger: true,
				},
			}
			: {},
	);
	if ( ! ok ) {
		return;
	}
	if ( verb !== 'activate' && plugins.some( ( plugin ) => selfGone( host, plugin ) ) ) {
		leaveAfterSelfMutation( host, verb === 'delete' );
		return;
	}
	host.broadcastChange( { action: 'bulk' } );
}

/** Update the selection one row at a time through the queue. */
async function runBulkUpdate( host: PluginsHost, ui: InstalledUi, rows: InstalledPlugin[] ): Promise< void > {
	let succeeded = 0;
	let failed = 0;
	for ( const row of rows ) {
		ui.updating.add( row.plugin );
		host.repaint();
		try {
			await enqueueUpdateJob( () => host.rest.updateInstalledPlugin( row ) );
			succeeded++;
		} catch {
			failed++;
		} finally {
			ui.updating.delete( row.plugin );
		}
	}
	host.repaint();
	if ( succeeded > 0 ) {
		host.broadcastChange( { action: 'bulk' } );
	}
	void host.refresh();
	void host.rest.refreshFrameworkMenu();
	const noun = __( 'updated', 'desktop-mode' );
	host.toast(
		failed === 0
			? sprintf(
				/* translators: 1: count, 2: action verb (activated, deactivated, deleted) */
				__( '%1$d plugin(s) %2$s.', 'desktop-mode' ),
				succeeded,
				noun,
			)
			: sprintf(
				/* translators: 1: success count, 2: failure count, 3: action verb */
				__( '%1$d %3$s, %2$d failed.', 'desktop-mode' ),
				succeeded,
				failed,
				noun,
			),
		5000,
	);
}
