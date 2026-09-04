/**
 * Plugins app — the Installed tab's table.
 *
 * Part of the `desktop-mode-plugins` client view. The `<os-table>`
 * lives under `os-preserve` in the view and is driven from `updated()`
 * through {@link syncInstalledTable} over the framework's
 * `createListTableSync()`: columns (icon + name, status, version with
 * the update badge, author, size, the "Automatic Updates" column when
 * the site allows it, actions), the expandable detail panel, selection
 * → bulk bar, and the phone layout (a card per row, fewer columns).
 * The cells wear classes from the sheet `styles.ts` adopts onto the
 * table's shadow root once. The verbs are `actions.ts`.
 *
 * @public
 */

import { __, createListTableSync, formatBytes, sprintf, type ListTableLike, type ListTableSync } from '@openstation/app';
import type { OsTable, OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import { pluginActionButtons, runToggleAutoUpdate } from './actions';
import { fallbackGlyph, stripHtml } from './html';
import { attachIconFallback } from './icon-fallback';
import { buildInstalledDetail, statusBadge } from './installed-detail';
import { TABLE_STYLES, adoptStyles } from './styles';
import { isActiveStatus, type InstalledPlugin, type PluginsHost } from './types';

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
	/** The framework's preserved-table sync. */
	table: ListTableSync< InstalledPlugin >;
	/** The rows' lowercase search haystacks, rebuilt when the list changes. */
	haystacks: { source: InstalledPlugin[] | null; byPlugin: Map< string, string > };
}

export const freshInstalledUi = (): InstalledUi => ( {
	selected: [],
	table: createListTableSync< InstalledPlugin >(),
	haystacks: { source: null, byPlugin: new Map() },
} );

/** The lowercase text a search matches against, computed once per list. */
export function haystacksFor( rows: InstalledPlugin[], cache: InstalledUi[ 'haystacks' ] ): Map< string, string > {
	if ( cache.source !== rows ) {
		cache.source = rows;
		cache.byPlugin = new Map(
			rows.map( ( row ) => [
				row.plugin,
				`${ row.name ?? '' } ${ row.plugin } ${ stripHtml( row.author ?? '' ) }`.toLowerCase(),
			] ),
		);
	}
	return cache.byPlugin;
}

/** The rows the current status segment + search leave visible. */
export function filterRows(
	rows: InstalledPlugin[],
	status: string,
	search: string,
	haystacks?: Map< string, string >,
): InstalledPlugin[] {
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
			const haystack =
				haystacks?.get( row.plugin ) ??
				`${ row.name ?? '' } ${ row.plugin } ${ stripHtml( row.author ?? '' ) }`.toLowerCase();
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
 * Drive the `<os-table>` after a paint: the framework's sync puts the
 * card list on a phone, wires the table once, clears a stale selection
 * when the view changed, and assigns the visible rows when anything
 * they paint from changed.
 */
export function syncInstalledTable(
	el: OsTable< InstalledPlugin >,
	host: PluginsHost,
	ui: InstalledUi,
	view: { status: string; search: string },
): void {
	const rows = filterRows( host.installed, view.status, view.search, haystacksFor( host.installed, ui.haystacks ) ).map(
		( row ) => ( host.busy.optimistic.has( row.plugin ) ? { ...row, status: host.busy.optimistic.get( row.plugin )! } : row ),
	);
	ui.table.sync( {
		table: el as unknown as ListTableLike< InstalledPlugin >,
		rows,
		listKey: `${ view.status }|${ view.search }`,
		fingerprint: fingerprint( rows, host ),
		rowId: ( row ) => row.plugin,
		columns: ( phone ) => buildColumns( host, phone ),
		wire: ( table ) => {
			if ( el.shadowRoot ) {
				adoptStyles( el.shadowRoot, 'plugins', TABLE_STYLES );
			}
			el.getRowId = ( row, index ) => row.plugin || String( index );
			// Every row expands into the rich detail panel; the action
			// buttons carry `data-noclick` so they stay independent.
			el.subTable = ( row ) => buildInstalledDetail( row, host );
			table.addEventListener( 'os-table-row-click', ( ev: Event ) => {
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
			table.addEventListener( 'os-table-selection-change', () => {
				ui.selected = Array.from( el.selection ?? [], String );
				host.repaint();
			} );
		},
		onSelection: ( kept ) => {
			ui.selected = kept;
		},
	} );
}

function fingerprint( rows: InstalledPlugin[], host: PluginsHost ): string {
	const body = rows
		.map(
			( r ) =>
				`${ r.plugin }:${ r.status }:${ r.version ?? '' }:${ r.openstation_update_available?.available ? r.openstation_update_available.new_version : '' }:${ r.openstation_auto_update?.enabled ? 1 : 0 }`,
		)
		.join( '|' );
	return `${ body }#${ Array.from( host.busy.updating ).join( ',' ) }#${ Array.from( host.busy.autoUpdating ).join( ',' ) }`;
}

// ─── Columns ───────────────────────────────────────────────────────

function buildColumns( host: PluginsHost, phone: boolean ): OsTableColumn< InstalledPlugin >[] {
	const { caps, autoUpdatesEnabled } = host.extra;
	const cols: OsTableColumn< InstalledPlugin >[] = [
		{ key: 'name', label: __( 'Plugin', 'desktop-mode' ), sortable: true, sticky: true, render: ( _v, row ) => renderNameCell( row ) },
		{ key: 'status', label: __( 'Status', 'desktop-mode' ), sortable: true, render: ( _v, row ) => statusBadge( row ) },
		{ key: 'version', label: __( 'Version', 'desktop-mode' ), sortable: true, render: ( _v, row ) => renderVersionCell( row ) },
		{ key: 'author', label: __( 'Author', 'desktop-mode' ), render: ( _v, row ) => renderAuthorCell( row ) },
		{
			key: 'openstation_size_kb',
			label: __( 'Size', 'desktop-mode' ),
			align: 'end',
			sortable: true,
			sortValue: ( row ) => row.openstation_size_kb ?? 0,
			render: ( _v, row ) =>
				row.openstation_size_kb === null || row.openstation_size_kb === undefined
					? '—'
					: formatBytes( row.openstation_size_kb * 1024 ),
		},
	];
	// Mirrors Core's `WP_Plugins_List_Table::$show_autoupdates` gate.
	if ( autoUpdatesEnabled ) {
		cols.push( {
			key: 'auto_updates',
			label: __( 'Automatic Updates', 'desktop-mode' ),
			sortable: true,
			sortValue: ( row ) => ( row.openstation_auto_update?.enabled ? 1 : 0 ),
			render: ( _v, row ) => renderAutoUpdateCell( host, row ),
		} );
	}
	if ( caps.activate || caps.delete ) {
		cols.push( { key: '_actions', label: '', align: 'end', render: ( _v, row ) => renderActionsCell( host, row ) } );
	}
	// A phone shows which plugin, whether it is on, and what can be done
	// to it; the rest is a tap away in the detail panel.
	return phone ? cols.filter( ( col ) => MOBILE_COLUMN_KEYS.has( col.key ) ) : cols;
}

function renderNameCell( row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__name-cell';
	const icon = document.createElement( 'div' );
	icon.className = 'os-plugins__name-icon';
	const url = row.openstation_icon_url;
	if ( url ) {
		const img = document.createElement( 'img' );
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.src = attachIconFallback( img, url, () => {
			icon.replaceChildren( fallbackGlyph() );
		} );
		icon.appendChild( img );
	} else {
		icon.appendChild( fallbackGlyph() );
	}
	const text = document.createElement( 'div' );
	text.className = 'os-plugins__name-text';
	const title = document.createElement( 'strong' );
	title.textContent = row.name || row.plugin;
	const path = document.createElement( 'span' );
	path.className = 'os-plugins__name-path';
	path.textContent = row.plugin;
	text.append( title, path );
	wrap.append( icon, text );
	return wrap;
}

function renderVersionCell( row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__version-cell';
	const v = document.createElement( 'span' );
	v.textContent = row.version ?? '—';
	wrap.appendChild( v );
	const update = row.openstation_update_available;
	if ( update?.available && update.new_version ) {
		const badge = document.createElement( 'span' );
		badge.className = 'os-plugins__update-badge';
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
	wrap.className = 'os-plugins__author-cell';
	wrap.textContent = stripHtml( row.author ?? '' ) || __( 'Unknown', 'desktop-mode' );
	return wrap;
}

/**
 * Core's three-state "Automatic Updates" cell: a read-only label when
 * a filter pinned the state, an em-dash when the plugin never checks
 * in with wp.org, a toggle otherwise (busy while in flight).
 */
function renderAutoUpdateCell( host: PluginsHost, row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'data-noclick', '' );
	wrap.className = 'os-plugins__auto-update';
	const meta = row.openstation_auto_update;
	const forced = meta?.forced ?? null;
	if ( forced !== null ) {
		const label = document.createElement( 'span' );
		label.className = 'os-plugins__auto-update-fixed';
		label.textContent = forced
			? __( 'Auto-updates enabled', 'desktop-mode' )
			: __( 'Auto-updates disabled', 'desktop-mode' );
		wrap.appendChild( label );
		return wrap;
	}
	if ( ! meta?.supported ) {
		const placeholder = document.createElement( 'span' );
		placeholder.className = 'os-plugins__auto-update-none';
		placeholder.textContent = '—';
		placeholder.title = __(
			'This plugin does not check in with WordPress.org, so automatic updates can\'t be scheduled.',
			'desktop-mode',
		);
		wrap.appendChild( placeholder );
		return wrap;
	}
	const enabled = !! meta.enabled;
	const busy = host.busy.autoUpdating.has( row.plugin );
	const toggle = document.createElement( 'os-button' );
	toggle.setAttribute( 'variant', 'link' );
	toggle.setAttribute( 'size', 'small' );
	toggle.setAttribute( 'data-wp-action', enabled ? 'disable' : 'enable' );
	if ( busy ) {
		toggle.setAttribute( 'busy', '' );
		toggle.setAttribute( 'disabled', '' );
		toggle.setAttribute( 'aria-busy', 'true' );
		toggle.textContent = enabled ? __( 'Disabling…', 'desktop-mode' ) : __( 'Enabling…', 'desktop-mode' );
	} else {
		toggle.textContent = enabled
			? __( 'Disable auto-updates', 'desktop-mode' )
			: __( 'Enable auto-updates', 'desktop-mode' );
	}
	toggle.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		void runToggleAutoUpdate( host, row );
	} );
	wrap.appendChild( toggle );
	return wrap;
}

function renderActionsCell( host: PluginsHost, row: InstalledPlugin ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__row-actions';
	wrap.setAttribute( 'data-noclick', '' );
	wrap.append( ...pluginActionButtons( host, row ) );
	return wrap;
}
