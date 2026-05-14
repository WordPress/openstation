/**
 * Native Plugins window — Installed tab.
 *
 * `<wpd-table>`-driven list of every plugin in `wp-content/plugins/`.
 * Columns: icon + name, status, version (with update badge), author,
 * size, actions. Bulk actions: activate, deactivate, delete.
 *
 * Mutation flow: optimistic-then-revert-on-failure. After every
 * successful mutation we call `refreshFrameworkMenu()` so the dock /
 * taskbar repaint live (see `src/boot/menu-refresh.ts` for the
 * underlying contract).
 *
 * @public
 * @since 0.9.0
 */

import { __, sprintf } from '../i18n';
import { broadcast, subscribe } from '../broadcast';
import { enqueueUpdateJob } from './update-queue';
import {
	activateInstalledPlugin,
	deactivateInstalledPlugin,
	updateInstalledPlugin,
	deleteInstalledPlugin,
	fetchInstalledPlugins,
	getConfig,
	isDesktopModeSelf,
	refreshFrameworkMenu,
	reloadOutOfDesktopMode,
} from './rest';

/**
 * Cross-view sync topic for the Plugins window.
 *
 * Emitted whenever one view (Installed / Browse) mutates plugin
 * state, so the other view re-fetches and re-paints rather than
 * showing a stale snapshot. The `source` field lets each view
 * skip self-emitted broadcasts (its mutation handler already
 * updated local state optimistically).
 *
 * @internal
 */
const PLUGINS_CHANGED_TOPIC = 'desktop-mode.plugin.changed';
const SOURCE = 'installed-view';
interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'update' | 'bulk';
}
import type { InstalledPlugin } from './types';
import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-badge/wpd-badge';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-text-field/wpd-text-field';

/** Toast helper, shell-routed when available. */
function toast( message: string, duration = 3500 ): void {
	const api = window.wp?.desktop;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( { message, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.log( '[plugins-window]', message );
}

/** Confirm-dialog helper, shell-routed when available. */
async function confirm( opts: {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
} ): Promise< boolean > {
	const api = window.wp?.desktop;
	if ( api && typeof api.confirm === 'function' ) {
		return api.confirm( opts );
	}
	// Last-resort UX fallback only fires in non-shell contexts (tests,
	// embedded previews). Production always has the shell.
	return Promise.resolve( true );
}

interface InstalledViewState {
	/** All rows from the most recent fetch. */
	rows: InstalledPlugin[];
	/** Status filter — `''` means All. */
	statusFilter: string;
	/** Free-text search (case-insensitive substring match). */
	search: string;
	/** Loading flag for the table skeleton. */
	loading: boolean;
	/**
	 * Set of plugin files currently in the update queue (enqueued or
	 * in-flight). Mirrors Core's `is-enqueued` row class — used to
	 * disable the Update button so a user can't double-fire while
	 * the queue is still draining.
	 */
	updating: Set< string >;
}

/**
 * Mount the Installed view into a host element. Returns a teardown
 * for the framework's window-closed cleanup pattern.
 */
export function mountInstalledView( host: HTMLElement ): () => void {
	host.replaceChildren();

	const state: InstalledViewState = {
		rows: [],
		statusFilter: '',
		search: '',
		loading: true,
		updating: new Set< string >(),
	};

	// ─── Toolbar ────────────────────────────────────────────────────
	const toolbar = document.createElement( 'header' );
	toolbar.className = 'desktop-mode-plugins__toolbar';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-plugins__toolbar-left';
	const statusFilter = document.createElement( 'wpd-segmented' );
	statusFilter.setAttribute( 'value', '' );
	const statusOptions: Array< { value: string; label: string } > = [
		{ value: '', label: __( 'All', 'desktop-mode' ) },
		{ value: 'active', label: __( 'Active', 'desktop-mode' ) },
		{ value: 'inactive', label: __( 'Inactive', 'desktop-mode' ) },
		{ value: 'update', label: __( 'Update available', 'desktop-mode' ) },
	];
	// Track the Update-available segment + its count badge so we can
	// repaint just the badge when rows change, without rebuilding the
	// whole segmented control (which would lose focus / selection).
	let updateCountBadge: HTMLElement | null = null;
	for ( const opt of statusOptions ) {
		const seg = document.createElement( 'wpd-segment' );
		seg.setAttribute( 'value', opt.value );
		if ( opt.value === 'update' ) {
			// Compose a labeled wrapper + a `<wpd-badge>` count chip.
			// `<wpd-segment>` slots its children into the light DOM, so
			// arbitrary HTML inside is fine — same posture other
			// segmented controls in the codebase use.
			const label = document.createElement( 'span' );
			label.textContent = opt.label;
			seg.appendChild( label );
			const badge = document.createElement( 'wpd-badge' );
			badge.setAttribute( 'tone', 'warning' );
			badge.setAttribute( 'no-dot', '' );
			badge.style.cssText = 'margin-inline-start:6px;';
			badge.hidden = true; // shown only when count > 0
			seg.appendChild( badge );
			updateCountBadge = badge;
		} else {
			seg.textContent = opt.label;
		}
		statusFilter.appendChild( seg );
	}
	statusFilter.addEventListener( 'wpd-pick', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		state.statusFilter = detail?.value ?? '';
		paintTable();
	} );

	const search = document.createElement( 'wpd-text-field' );
	search.setAttribute(
		'placeholder',
		__( 'Search installed plugins…', 'desktop-mode' ),
	);
	let searchDebounce: number | undefined;
	search.addEventListener( 'wpd-input-change', ( ev: Event ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail?.value ?? '';
		window.clearTimeout( searchDebounce );
		searchDebounce = window.setTimeout( () => {
			state.search = value;
			paintTable();
		}, 200 );
	} );

	left.append( statusFilter, search );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-plugins__toolbar-right';
	const bulkBar = document.createElement( 'div' );
	bulkBar.className = 'desktop-mode-plugins__bulk';
	bulkBar.hidden = true;
	right.appendChild( bulkBar );

	const trailing = document.createElement( 'div' );
	trailing.className = 'desktop-mode-plugins__toolbar-trailing';
	const refreshButton = document.createElement( 'wpd-button' );
	refreshButton.setAttribute( 'variant', 'ghost' );
	refreshButton.setAttribute( 'title', __( 'Refresh', 'desktop-mode' ) );
	refreshButton.innerHTML =
		'<span class="dashicons dashicons-update" aria-hidden="true"></span>';
	refreshButton.addEventListener( 'click', () => {
		// User-initiated refresh — force a fresh wp.org check
		// server-side (bypass the 12h `update_plugins` throttle) and
		// also kick the framework menu refresh so the Plugins dock
		// badge re-paints from the same fresh snapshot. Without the
		// dock refresh, the in-window list and the dock-icon count
		// could drift apart after a manual click — see GH#202.
		void ( async () => {
			await reload( { force: true } );
			void refreshFrameworkMenu();
		} )();
	} );
	trailing.appendChild( refreshButton );

	toolbar.append( left, right, trailing );

	// ─── Table ──────────────────────────────────────────────────────
	const tableWrap = document.createElement( 'div' );
	tableWrap.className = 'desktop-mode-plugins__body';
	const table = document.createElement( 'wpd-table' ) as WpdTable< InstalledPlugin >;
	table.setAttribute( 'selectable', 'multi' );
	table.setAttribute( 'sticky-header', '' );
	table.setAttribute( 'sticky-columns', '1' );
	table.setAttribute( 'hover', '' );
	table.setAttribute( 'striped', '' );
	table.setAttribute( 'bordered', '' );
	table.setAttribute( 'loading', '' );

	const empty = document.createElement( 'div' );
	empty.setAttribute( 'slot', 'empty' );
	empty.className = 'desktop-mode-plugins__empty';
	empty.innerHTML =
		'<span class="dashicons dashicons-admin-plugins" aria-hidden="true"></span>' +
		'<p>' +
		__( 'No plugins match your filters.', 'desktop-mode' ) +
		'</p>';
	table.appendChild( empty );

	const getRowId = ( row: InstalledPlugin, index: number ): string =>
		row.plugin || String( index );
	table.getRowId = getRowId;
	table.columns = buildColumns();

	tableWrap.appendChild( table );

	host.append( toolbar, tableWrap );

	// ─── Selection → bulk-bar ──────────────────────────────────────
	const selectionListener = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { selection: string[] } > ).detail;
		const ids = detail?.selection ?? [];
		paintBulkBar( ids );
	};
	table.addEventListener( 'wpd-table-selection-change', selectionListener );

	// ─── Initial fetch ──────────────────────────────────────────────
	void reload();

	function buildColumns(): WpdTableColumn< InstalledPlugin >[] {
		const cfg = getConfig();
		const cols: WpdTableColumn< InstalledPlugin >[] = [
			{
				key: 'name',
				label: __( 'Plugin', 'desktop-mode' ),
				sortable: true,
				sticky: true,
				render: ( _value, row ) => renderNameCell( row ),
			},
			{
				key: 'status',
				label: __( 'Status', 'desktop-mode' ),
				sortable: true,
				render: ( _value, row ) => renderStatusCell( row ),
			},
			{
				key: 'version',
				label: __( 'Version', 'desktop-mode' ),
				sortable: true,
				render: ( _value, row ) => renderVersionCell( row ),
			},
			{
				key: 'author',
				label: __( 'Author', 'desktop-mode' ),
				render: ( _value, row ) => renderAuthorCell( row ),
			},
			{
				key: 'desktop_mode_size_kb',
				label: __( 'Size', 'desktop-mode' ),
				align: 'end',
				sortable: true,
				sortValue: ( row: InstalledPlugin ) => row.desktop_mode_size_kb ?? 0,
				render: ( _value, row ) => formatSize( row.desktop_mode_size_kb ?? null ),
			},
			{
				key: '_actions',
				label: '',
				align: 'end',
				render: ( _value, row ) => renderActionsCell( row ),
			},
		];
		return cfg.caps.activate || cfg.caps.delete ? cols : cols.slice( 0, -1 );
	}

	// Cell renderers use INLINE styles instead of class selectors —
	// `<wpd-table>` cells live inside its shadow DOM, so document
	// CSS rules don't reach them. Same posture posts-window uses.

	function renderNameCell( row: InstalledPlugin ): HTMLElement {
		const wrap = document.createElement( 'div' );
		wrap.style.cssText =
			'display:flex;align-items:center;gap:12px;min-width:0;padding:4px 0;';

		const icon = document.createElement( 'div' );
		icon.style.cssText =
			'flex:0 0 32px;width:32px;height:32px;max-width:32px;max-height:32px;' +
			'border-radius:6px;overflow:hidden;display:flex;align-items:center;' +
			'justify-content:center;background:rgba(0,0,0,0.04);box-sizing:border-box;';

		const url = row.desktop_mode_icon_url;
		if ( url ) {
			const img = document.createElement( 'img' );
			img.src = url;
			img.alt = '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.style.cssText =
				'width:100%;height:100%;max-width:100%;max-height:100%;' +
				'object-fit:contain;display:block;';
			img.addEventListener( 'error', () => {
				icon.replaceChildren( buildFallbackIcon() );
			} );
			icon.appendChild( img );
		} else {
			icon.appendChild( buildFallbackIcon() );
		}

		const text = document.createElement( 'div' );
		text.style.cssText =
			'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;' +
			'line-height:1.35;';

		const title = document.createElement( 'strong' );
		title.textContent = row.name || row.plugin;
		title.style.cssText =
			'display:block;font-weight:600;white-space:nowrap;overflow:hidden;' +
			'text-overflow:ellipsis;';

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
		fallback.style.cssText =
			'font-size:18px;width:18px;height:18px;line-height:18px;color:#888;';
		return fallback;
	}

	function renderStatusCell( row: InstalledPlugin ): HTMLElement {
		const badge = document.createElement( 'span' );
		const isActive =
			row.status === 'active' || row.status === 'active-network';
		const dot = isActive ? '#16a34a' : '#9ca3af';
		const bg = isActive ? 'rgba(22, 163, 74, 0.14)' : 'rgba(120, 120, 120, 0.12)';
		const fg = isActive ? '#166e37' : '#555';
		badge.style.cssText =
			`display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 8px;` +
			`border-radius:999px;font-size:0.78em;font-weight:600;line-height:1.4;` +
			`white-space:nowrap;background:${ bg };color:${ fg };`;
		const dotEl = document.createElement( 'span' );
		dotEl.style.cssText =
			`width:6px;height:6px;border-radius:50%;background:${ dot };` +
			'flex:0 0 auto;display:inline-block;';
		badge.appendChild( dotEl );
		const label = document.createElement( 'span' );
		label.textContent = isActive
			? __( 'Active', 'desktop-mode' )
			: __( 'Inactive', 'desktop-mode' );
		badge.appendChild( label );
		return badge;
	}

	function renderVersionCell( row: InstalledPlugin ): HTMLElement {
		const wrap = document.createElement( 'div' );
		wrap.style.cssText =
			'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
		const v = document.createElement( 'span' );
		v.textContent = row.version ?? '—';
		wrap.appendChild( v );
		const update = row.desktop_mode_update_available;
		if ( update?.available && update.new_version ) {
			const badge = document.createElement( 'span' );
			badge.style.cssText =
				'font-size:0.78em;background:rgba(245,175,0,0.18);' +
				'color:#915f00;padding:1px 7px;border-radius:999px;font-weight:600;';
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
		wrap.style.cssText =
			'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;';
		const text = stripHtml( row.author ?? '' );
		wrap.textContent = text || __( 'Unknown', 'desktop-mode' );
		return wrap;
	}

	function renderActionsCell( row: InstalledPlugin ): HTMLElement {
		const wrap = document.createElement( 'div' );
		wrap.style.cssText =
			'display:inline-flex;gap:8px;align-items:center;justify-content:flex-end;' +
			'flex-wrap:nowrap;';
		// Mark as `data-noclick` so wpd-table doesn't fire row-click on
		// these buttons.
		wrap.setAttribute( 'data-noclick', '' );

		const can = row.desktop_mode_can_manage ?? {
			activate: row.status === 'inactive',
			deactivate: row.status === 'active' || row.status === 'active-network',
			delete: row.status === 'inactive',
		};

		// Update action — mirrors Core's `wp_plugin_update_row()` inline
		// "Update now" link. Gated by the global `update_plugins` cap
		// (Core's same check) and the presence of a `package` URL on the
		// transient entry; when `available && ! package` we surface the
		// disabled "Auto-update unavailable" hint Core renders.
		const update = row.desktop_mode_update_available;
		if ( getConfig().caps.update && update?.available ) {
			if ( update.package ) {
				const updating = state.updating.has( row.plugin );
				const label = updating
					? __( 'Updating…', 'desktop-mode' )
					: sprintf(
						/* translators: %s: new plugin version (e.g. "1.4.2") */
						__( 'Update to %s', 'desktop-mode' ),
						update.new_version ?? '',
					);
				const btn = button( label, 'primary' );
				if ( updating ) {
					btn.setAttribute( 'disabled', '' );
					btn.setAttribute( 'aria-busy', 'true' );
				}
				btn.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					void runUpdate( row );
				} );
				wrap.appendChild( btn );
			} else {
				const hint = document.createElement( 'span' );
				hint.style.cssText =
					'font-size:0.78em;color:var(--wp-desktop-text-muted,#666);';
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
				void runActivate( row );
			} );
			wrap.appendChild( btn );
		} else if ( can.deactivate ) {
			const btn = button( __( 'Deactivate', 'desktop-mode' ), 'secondary' );
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void runDeactivate( row );
			} );
			wrap.appendChild( btn );
		}

		if ( can.delete ) {
			const btn = button( __( 'Delete', 'desktop-mode' ), 'danger' );
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void runDelete( row );
			} );
			wrap.appendChild( btn );
		}

		return wrap;
	}

	function button( label: string, variant: string ): HTMLElement {
		const b = document.createElement( 'wpd-button' );
		b.setAttribute( 'variant', variant );
		b.setAttribute( 'size', 'small' );
		b.textContent = label;
		return b;
	}

	function paintBulkBar( ids: string[] ): void {
		bulkBar.replaceChildren();
		if ( ids.length === 0 ) {
			bulkBar.hidden = true;
			return;
		}
		bulkBar.hidden = false;

		const count = document.createElement( 'span' );
		count.className = 'desktop-mode-plugins__bulk-count';
		count.textContent = sprintf(
			/* translators: %d: number of selected plugins */
			__( '%d selected', 'desktop-mode' ),
			ids.length,
		);
		bulkBar.appendChild( count );

		const cfg = getConfig();
		const selected = state.rows.filter( ( r ) => ids.includes( r.plugin ) );

		if ( cfg.caps.update ) {
			const updatable = selected.filter(
				( r ) =>
					!! r.desktop_mode_update_available?.available &&
					!! r.desktop_mode_update_available.package,
			);
			if ( updatable.length > 0 ) {
				const btn = button(
					sprintf(
						/* translators: %d: number of plugins with pending updates */
						__( 'Update %d', 'desktop-mode' ),
						updatable.length,
					),
					'primary',
				);
				btn.addEventListener( 'click', () => {
					void runBulk( updatable, 'update' );
				} );
				bulkBar.appendChild( btn );
			}
		}

		if ( cfg.caps.activate ) {
			const activatable = selected.filter( ( r ) => r.status === 'inactive' );
			if ( activatable.length > 0 ) {
				const btn = button( __( 'Activate', 'desktop-mode' ), 'primary' );
				btn.addEventListener( 'click', () => {
					void runBulk( activatable, 'activate' );
				} );
				bulkBar.appendChild( btn );
			}
			const deactivatable = selected.filter(
				( r ) => r.status === 'active' || r.status === 'active-network',
			);
			if ( deactivatable.length > 0 ) {
				const btn = button( __( 'Deactivate', 'desktop-mode' ), 'secondary' );
				btn.addEventListener( 'click', () => {
					void runBulk( deactivatable, 'deactivate' );
				} );
				bulkBar.appendChild( btn );
			}
		}

		if ( cfg.caps.delete ) {
			const deletable = selected.filter( ( r ) => r.status === 'inactive' );
			if ( deletable.length > 0 ) {
				const btn = button( __( 'Delete', 'desktop-mode' ), 'danger' );
				btn.addEventListener( 'click', () => {
					void runBulk( deletable, 'delete' );
				} );
				bulkBar.appendChild( btn );
			}
		}
	}

	async function reload( opts: { force?: boolean } = {} ): Promise< void > {
		state.loading = true;
		table.setAttribute( 'loading', '' );
		try {
			state.rows = await fetchInstalledPlugins( opts );
		} catch ( err ) {
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Could not load plugins: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
			state.rows = [];
		}
		state.loading = false;
		paintTable();
	}

	function paintTable(): void {
		if ( state.loading ) {
			table.setAttribute( 'loading', '' );
		} else {
			table.removeAttribute( 'loading' );
		}
		table.data = filterRows( state.rows );
		paintUpdateCount();
	}

	/**
	 * Refresh the "Update available" segment's count badge to reflect
	 * how many rows in `state.rows` (the full list, NOT the current
	 * filtered view) currently have a pending update. Hidden when the
	 * count is zero so the segment falls back to a plain text label.
	 */
	function paintUpdateCount(): void {
		if ( ! updateCountBadge ) {
			return;
		}
		const count = state.rows.filter(
			( r ) => !! r.desktop_mode_update_available?.available,
		).length;
		if ( count > 0 ) {
			updateCountBadge.textContent = String( count );
			updateCountBadge.hidden = false;
		} else {
			updateCountBadge.hidden = true;
			updateCountBadge.textContent = '';
		}
	}

	function filterRows( rows: InstalledPlugin[] ): InstalledPlugin[] {
		const q = state.search.trim().toLowerCase();
		const status = state.statusFilter;
		return rows.filter( ( row ) => {
			if ( status === 'active' ) {
				if ( row.status !== 'active' && row.status !== 'active-network' ) {
					return false;
				}
			} else if ( status === 'inactive' ) {
				if ( row.status !== 'inactive' ) {
					return false;
				}
			} else if ( status === 'update' ) {
				if ( ! row.desktop_mode_update_available?.available ) {
					return false;
				}
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

	async function runActivate( row: InstalledPlugin ): Promise< void > {
		const previous = row.status;
		applyStatusOptimistic( row, 'active' );
		try {
			const updated = await activateInstalledPlugin( row );
			mergeRow( updated );
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s activated.', 'desktop-mode' ),
					row.name || row.plugin,
				),
			);
			broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
				source: SOURCE,
				plugin: row.plugin,
				action: 'activate',
			} );
			// Background — the table's status badge already flipped via
			// `mergeRow` above; the menu refresh is a slow hidden-iframe
			// load that only needs to keep the dock/taskbar in sync.
			void refreshFrameworkMenu();
		} catch ( err ) {
			applyStatusOptimistic( row, previous );
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Activation failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	async function runDeactivate( row: InstalledPlugin ): Promise< void > {
		const previous = row.status;
		applyStatusOptimistic( row, 'inactive' );
		try {
			const updated = await deactivateInstalledPlugin( row );
			mergeRow( updated );
			// Special-case: deactivating Desktop Mode itself leaves the
			// shell running on top of a now-defunct plugin. Skip the
			// menu refresh (the chromeless probe lands on a dead plugin
			// and times out) and just reload the page so the user
			// lands on the classic admin.
			if ( isDesktopModeSelf( row.plugin ) ) {
				toast(
					__(
						'Desktop Mode deactivated. Reloading…',
						'desktop-mode',
					),
					2000,
				);
				reloadOutOfDesktopMode();
				return;
			}
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s deactivated.', 'desktop-mode' ),
					row.name || row.plugin,
				),
			);
			broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
				source: SOURCE,
				plugin: row.plugin,
				action: 'deactivate',
			} );
			void refreshFrameworkMenu();
		} catch ( err ) {
			applyStatusOptimistic( row, previous );
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Deactivation failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	async function runDelete( row: InstalledPlugin ): Promise< void > {
		const ok = await confirm( {
			title: __( 'Delete plugin?', 'desktop-mode' ),
			message: sprintf(
				/* translators: %s: plugin name */
				__(
					'Permanently delete %s? Its files will be removed from disk. This cannot be undone.',
					'desktop-mode',
				),
				row.name || row.plugin,
			),
			confirmLabel: __( 'Delete', 'desktop-mode' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await deleteInstalledPlugin( row );
			state.rows = state.rows.filter( ( r ) => r.plugin !== row.plugin );
			paintTable();
			// Same self-deactivate guard — deleting Desktop Mode also
			// strands the shell on top of a missing plugin.
			if ( isDesktopModeSelf( row.plugin ) ) {
				toast(
					__(
						'Desktop Mode deleted. Reloading…',
						'desktop-mode',
					),
					2000,
				);
				reloadOutOfDesktopMode();
				return;
			}
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s deleted.', 'desktop-mode' ),
					row.name || row.plugin,
				),
			);
			broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
				source: SOURCE,
				plugin: row.plugin,
				action: 'delete',
			} );
			void refreshFrameworkMenu();
		} catch ( err ) {
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Delete failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	/**
	 * Update a single plugin via Core's `wp_ajax_update_plugin`
	 * handler, serialized through the single-flight queue. The queue
	 * is critical — concurrent runs corrupt the `update_plugins`
	 * transient (see comment in Core's ajax handler). Marks the row
	 * "updating" up-front so the button paints disabled while waiting.
	 */
	async function runUpdate( row: InstalledPlugin ): Promise< void > {
		if ( state.updating.has( row.plugin ) ) {
			return; // already enqueued / in flight
		}
		state.updating.add( row.plugin );
		paintTable();
		try {
			const result = await enqueueUpdateJob( () => updateInstalledPlugin( row ) );
			// Drop the pending-update marker and bump the version
			// on the row so the table repaints without a refetch.
			mergeRow( {
				...row,
				version: result.newVersion,
				desktop_mode_update_available: {
					available: false,
					new_version: null,
					package: '',
					slug: row.desktop_mode_update_available?.slug ?? '',
				},
			} as InstalledPlugin );
			toast(
				sprintf(
					/* translators: 1: plugin name, 2: new version */
					__( '%1$s updated to %2$s.', 'desktop-mode' ),
					row.name || row.plugin,
					result.newVersion,
				),
			);
			broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
				source: SOURCE,
				plugin: row.plugin,
				action: 'update',
			} );
			void refreshFrameworkMenu();
		} catch ( err ) {
			// Detect Core's "plugin is already at the latest version"
			// signal. Core's `wp_ajax_update_plugin` only emits
			// `errorCode` for `WP_Error`-shaped failures — the
			// up-to-date branch (line 4685 of ajax-actions.php) sets
			// only `errorMessage`, the translated string
			// `__( 'The plugin is at the latest version.' )` from the
			// `default` textdomain. So we detect on either signal:
			//   1. `errorCode === 'up_to_date'` (future-proof — if Core
			//      ever ships the code, we already match).
			//   2. The translated `errorMessage` equals Core's own
			//      string in the user's locale (the current shipping
			//      behavior). `wp.i18n.__` against the `default`
			//      textdomain returns the same translation Core used
			//      server-side, so the comparison is locale-correct.
			// This happens in two real-world scenarios:
			//   - A prior update succeeded server-side but the client
			//     didn't see the success envelope (network hiccup, the
			//     iframe-bridge / shellFetch race the user hit in
			//     GH#202). The next click reaches Core's transient
			//     check, which now says "nothing to do".
			//   - Benign double-clicks within the same window.
			// Either way the truth is "the row IS up to date" — so
			// converge the UI to that reality instead of leaving the
			// stale "Update available" button + scary "failed" toast.
			const errCode = ( err as { code?: string } )?.code;
			const errMessage = ( err as { message?: string } )?.message;
			const coreUpToDateMessage =
				window.wp?.i18n?.__?.( 'The plugin is at the latest version.' );
			const isUpToDate =
				errCode === 'up_to_date' ||
				( !! coreUpToDateMessage && errMessage === coreUpToDateMessage );

			if ( isUpToDate ) {
				mergeRow( {
					...row,
					desktop_mode_update_available: {
						available: false,
						new_version: null,
						package: '',
						slug: row.desktop_mode_update_available?.slug ?? '',
					},
				} as InstalledPlugin );
				toast(
					sprintf(
						/* translators: %s: plugin name */
						__( '%s is already up to date.', 'desktop-mode' ),
						row.name || row.plugin,
					),
				);
				broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
					source: SOURCE,
					plugin: row.plugin,
					action: 'update',
				} );
			} else {
				toast(
					sprintf(
						/* translators: 1: plugin name, 2: error message */
						__( 'Update of %1$s failed: %2$s', 'desktop-mode' ),
						row.name || row.plugin,
						describe( err ),
					),
					6000,
				);
				// Reconcile from the server — covers the case where the
				// upgrader committed the install on disk but the client
				// promise rejected (timeout, dropped connection, parse
				// error). Without this, the row stays stuck on "Update
				// available" even though the on-disk version is fresh,
				// which is the exact GH#202 symptom.
				void reload();
			}
			// Always refresh the dock badge after an update attempt,
			// regardless of branch. Core's `wp_ajax_update_plugin` calls
			// `wp_update_plugins()` up front, which may mutate the
			// `update_plugins` transient even when the upgrade itself
			// errors out — so the badge count can change even on
			// failure. Without this, the badge could lag behind the
			// in-window state until the user manually clicked Refresh.
			void refreshFrameworkMenu();
		} finally {
			state.updating.delete( row.plugin );
			paintTable();
		}
	}

	async function runBulk(
		rows: InstalledPlugin[],
		action: 'activate' | 'deactivate' | 'delete' | 'update',
	): Promise< void > {
		if ( rows.length === 0 ) {
			return;
		}
		if ( action === 'delete' ) {
			const ok = await confirm( {
				title: __( 'Delete selected plugins?', 'desktop-mode' ),
				message: sprintf(
					/* translators: %d: number of plugins */
					__(
						'Permanently delete %d plugin(s)? Their files will be removed from disk. This cannot be undone.',
						'desktop-mode',
					),
					rows.length,
				),
				confirmLabel: __( 'Delete', 'desktop-mode' ),
				danger: true,
			} );
			if ( ! ok ) {
				return;
			}
		}
		let succeeded = 0;
		let selfMutated = false;
		const failures: Array< { row: InstalledPlugin; err: unknown } > = [];
		for ( const row of rows ) {
			try {
				if ( action === 'activate' ) {
					mergeRow( await activateInstalledPlugin( row ) );
				} else if ( action === 'deactivate' ) {
					mergeRow( await deactivateInstalledPlugin( row ) );
				} else if ( action === 'delete' ) {
					await deleteInstalledPlugin( row );
					state.rows = state.rows.filter( ( r ) => r.plugin !== row.plugin );
				} else if ( action === 'update' ) {
					// Route through the single-flight queue so all
					// rows fan in serially (mirrors Core's behavior;
					// concurrent `Plugin_Upgrader` runs corrupt the
					// transient).
					state.updating.add( row.plugin );
					paintTable();
					try {
						const result = await enqueueUpdateJob( () =>
							updateInstalledPlugin( row ),
						);
						mergeRow( {
							...row,
							version: result.newVersion,
							desktop_mode_update_available: {
								available: false,
								new_version: null,
								package: '',
								slug: row.desktop_mode_update_available?.slug ?? '',
							},
						} as InstalledPlugin );
					} finally {
						state.updating.delete( row.plugin );
					}
				}
				if (
					( action === 'deactivate' || action === 'delete' ) &&
					isDesktopModeSelf( row.plugin )
				) {
					selfMutated = true;
				}
				succeeded++;
			} catch ( err ) {
				failures.push( { row, err } );
			}
		}
		paintTable();
		table.clearSelection();
		// Self-mutation in a bulk: reload before the menu refresh so we
		// don't waste time on a probe that will time out.
		if ( selfMutated ) {
			toast(
				action === 'delete'
					? __( 'Desktop Mode deleted. Reloading…', 'desktop-mode' )
					: __( 'Desktop Mode deactivated. Reloading…', 'desktop-mode' ),
				2000,
			);
			reloadOutOfDesktopMode();
			return;
		}
		if ( succeeded > 0 ) {
			broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
				source: SOURCE,
				action: 'bulk',
			} );
		}
		void refreshFrameworkMenu();
		let noun = '';
		if ( action === 'delete' ) {
			noun = __( 'deleted', 'desktop-mode' );
		} else if ( action === 'activate' ) {
			noun = __( 'activated', 'desktop-mode' );
		} else if ( action === 'update' ) {
			noun = __( 'updated', 'desktop-mode' );
		} else {
			noun = __( 'deactivated', 'desktop-mode' );
		}
		const summary =
			failures.length === 0
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
					failures.length,
					noun,
				);
		toast( summary, 5000 );
	}

	function applyStatusOptimistic(
		row: InstalledPlugin,
		next: InstalledPlugin[ 'status' ],
	): void {
		row.status = next;
		paintTable();
	}

	function mergeRow( updated: InstalledPlugin ): void {
		const idx = state.rows.findIndex( ( r ) => r.plugin === updated.plugin );
		if ( idx >= 0 ) {
			state.rows[ idx ] = { ...state.rows[ idx ], ...updated };
		} else {
			state.rows.push( updated );
		}
		paintTable();
	}

	// Cross-view sync: when the Browse tab installs/activates a
	// plugin, refresh the installed list so the row reflects the
	// new state without the user having to switch tabs and back.
	// Self-emitted broadcasts are skipped — our mutation handlers
	// already painted the new state.
	const unsubscribePluginsChanged = subscribe< PluginsChangedPayload >(
		PLUGINS_CHANGED_TOPIC,
		( payload ) => {
			if ( payload?.source === SOURCE ) {
				return;
			}
			void reload();
		},
	);

	return () => {
		unsubscribePluginsChanged();
		table.removeEventListener( 'wpd-table-selection-change', selectionListener );
		host.replaceChildren();
	};
}

function formatSize( kb: number | null ): string {
	if ( kb === null || kb === undefined ) {
		return '—';
	}
	if ( kb < 1024 ) {
		return sprintf(
			/* translators: %d: size in kilobytes */
			__( '%d KB', 'desktop-mode' ),
			kb,
		);
	}
	const mb = kb / 1024;
	return sprintf(
		/* translators: %s: size in megabytes (one decimal) */
		__( '%s MB', 'desktop-mode' ),
		mb.toFixed( 1 ),
	);
}

function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}

function describe( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}
