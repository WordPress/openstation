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
import {
	activateInstalledPlugin,
	deactivateInstalledPlugin,
	deleteInstalledPlugin,
	fetchInstalledPlugins,
	getConfig,
	isDesktopModeSelf,
	refreshFrameworkMenu,
	reloadOutOfDesktopMode,
} from './rest';
import type { InstalledPlugin } from './types';
import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';

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
	for ( const opt of statusOptions ) {
		const seg = document.createElement( 'wpd-segment' );
		seg.setAttribute( 'value', opt.value );
		seg.textContent = opt.label;
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
		void reload();
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

	async function reload(): Promise< void > {
		state.loading = true;
		table.setAttribute( 'loading', '' );
		try {
			state.rows = await fetchInstalledPlugins();
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

	async function runBulk(
		rows: InstalledPlugin[],
		action: 'activate' | 'deactivate' | 'delete',
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
		void refreshFrameworkMenu();
		let noun = '';
		if ( action === 'delete' ) {
			noun = __( 'deleted', 'desktop-mode' );
		} else if ( action === 'activate' ) {
			noun = __( 'activated', 'desktop-mode' );
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

	return () => {
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
