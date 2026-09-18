/**
 * Installed plugins as a library: attention groups, local selection,
 * nearby actions and a focused inspector. No server state or API changes.
 */
import { __, formatBytes, html, sprintf, type TemplateResult } from '@openstation/app';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-checkbox/os-checkbox';
import '../../../src/ui/components/os-grid/os-grid';
import { changeInstalledView } from './view-preference';
import { syncInstalledTable, type InstalledTableState } from './installed-table';
import { libraryStyles } from './library.styles';
import { bulkButtons, pluginActionButtons, runToggleAutoUpdate } from './actions';
import { stripHtml } from './html';
import { attachIconFallback } from './icon-fallback';
import { buildInstalledDetail } from './installed-detail';
import { DETAIL_STYLES, adoptStyles } from './styles';
import { isActiveStatus, type Ctx, type InstalledPlugin, type PluginsHost } from './types';

/** Per-window library state; selection never includes a hidden plugin. */
export interface InstalledUi {
	selected: string[];
	savingView: boolean;
	table: InstalledTableState;
	rows: InstalledPlugin[];
	focused: string;
	sort: string;
	layoutKey: string;
	haystacks: { source: InstalledPlugin[] | null; byPlugin: Map<string, string> };
	controls: Map<string, { key: string; actions: HTMLElement[] }>;
	detail: { key: string; node: HTMLElement } | null;
	icons: Map<string, { key: string; node: HTMLElement }>;
	autoUpdate: { key: string; node: HTMLElement } | null;
}

export const freshInstalledUi = (): InstalledUi => ( {
	selected: [],
	savingView: false,
	table: { element: null, key: '' },
	rows: [],
	focused: '',
	sort: 'attention',
	layoutKey: '',
	haystacks: { source: null, byPlugin: new Map() },
	controls: new Map(),
	detail: null,
	icons: new Map(),
	autoUpdate: null,
} );

/** The lowercase text a search matches against, computed once per list. */
export function haystacksFor( rows: InstalledPlugin[], cache: InstalledUi['haystacks'] ): Map<string, string> {
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

/** The plugins the current collection and search leave visible. */
export function filterRows(
	rows: InstalledPlugin[],
	status: string,
	search: string,
	haystacks?: Map<string, string>,
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

/** Rows with a pending update — the Updates collection count. */
export function countUpdates( rows: InstalledPlugin[] ): number {
	return rows.filter( ( r ) => !! r.openstation_update_available?.available ).length;
}

/** Group a plugin once, according to the next useful task. */
export function pluginLane( row: InstalledPlugin ): string {
	if ( row.openstation_update_available?.available ) {
		return 'update';
	}
	return isActiveStatus( row.status ) ? 'active' : 'inactive';
}

/** Keep controls stable while selecting, searching or opening details. */
function actionsFor( host: PluginsHost, ui: InstalledUi, row: InstalledPlugin, surface = 'card' ): HTMLElement[] {
	const key = JSON.stringify( [
		row,
		host.extra.caps,
		host.busy.updating.has( row.plugin ),
		host.busy.optimistic.has( row.plugin ),
	] );
	let cached = ui.controls.get( `${ surface }:${ row.plugin }` );
	if ( ! cached || cached.key !== key ) {
		const actions = pluginActionButtons( host, row );
		if ( host.busy.optimistic.has( row.plugin ) || host.busy.updating.has( row.plugin ) ) {
			for ( const action of actions ) {
				action.setAttribute( 'disabled', '' );
				action.setAttribute( 'aria-busy', 'true' );
			}
		}
		cached = { key, actions };
		ui.controls.set( `${ surface }:${ row.plugin }`, cached );
	}
	return cached.actions;
}

/** Close the inspector and return keyboard focus to its library control. */
function closeDetail( ctx: Ctx, ui: InstalledUi ): void {
	const plugin = ui.focused;
	ui.focused = '';
	ctx.repaint();
	const card = Array.from( ctx.root.querySelectorAll<HTMLElement>( '[data-plugin-card]' ) ).find(
		( el ) => el.dataset.pluginCard === plugin,
	);
	const tableControl = Array.from( ui.table.element?.shadowRoot?.querySelectorAll<HTMLElement>( '[data-plugin-actions]' ) ?? [] )
		.find( ( el ) => el.getAttribute( 'data-plugin-actions' ) === plugin );
	queueMicrotask( () => {
		const control = tableControl?.shadowRoot?.querySelector( 'os-button' ) ?? card?.querySelector( '[data-plugin-details]' );
		control?.shadowRoot?.querySelector( 'button' )?.focus();
	} );
}

function pluginCard( ctx: Ctx, host: PluginsHost, ui: InstalledUi, row: InstalledPlugin ): TemplateResult {
	const name = stripHtml( row.name ) || row.plugin;
	const active = isActiveStatus( row.status );
	const updating = host.busy.updating.has( row.plugin );
	const pending = host.busy.optimistic.has( row.plugin );
	const update = row.openstation_update_available;
	let status = active ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' );
	if ( row.status === 'network-active' ) {
		status = __( 'Network active', 'desktop-mode' );
	}
	if ( pending ) {
		status = __( 'Changing status…', 'desktop-mode' );
	}
	const description =
		typeof row.description === 'string' ? row.description : row.description?.rendered || row.description?.raw || '';
	const open = (): void => {
		ui.focused = row.plugin;
		ctx.repaint();
		queueMicrotask( () =>
			ctx.root.querySelector( '[data-plugin-back]' )?.shadowRoot?.querySelector( 'button' )?.focus(),
		);
	};
	const select = ( ev: Event ): void => {
		const checked = ( ev as CustomEvent<{ checked: boolean }> ).detail.checked;
		ui.selected = checked
			? [ ...new Set( [ ...ui.selected, row.plugin ] ) ]
			: ui.selected.filter( ( id ) => id !== row.plugin );
		ctx.repaint();
	};
	return html`<os-card
		class="os-plugins__module"
		data-plugin-card=${ row.plugin }
		os-key=${ row.plugin }
		?selected=${ ui.focused === row.plugin || ui.selected.includes( row.plugin ) }
		data-lane=${ pluginLane( row ) }
		aria-label=${ name }
	>
		<div class="os-plugins__module-top">
			${ pluginIcon( ui, row ) }
			<div class="os-plugins__module-identity">
				<h3>${ name }</h3>
				<span>${ stripHtml( row.author ?? '' ) || __( 'Independent plugin', 'desktop-mode' ) }</span>
			</div>
			<os-checkbox
				class="os-plugins__pick"
				?checked=${ ui.selected.includes( row.plugin ) }
				aria-label=${ sprintf( /* translators: %s: plugin name */ __( 'Select %s', 'desktop-mode' ), name ) }
				@os-checkbox-change=${ select }
			></os-checkbox>
		</div>
		<p class="os-plugins__module-description">
			${ stripHtml( description ) || __( 'No description provided.', 'desktop-mode' ) }
		</p>
		<div class="os-plugins__module-meta">
			<span class="os-plugins__state" data-active=${ active ? 'true' : 'false' }> ${ status } </span>
			<span
				>${ ui.sort === 'size' && typeof row.openstation_size_kb === 'number'
					? html`<span>${ formatBytes( row.openstation_size_kb * 1024 ) } · </span>`
					: '' }${ row.version || '—' }${ update?.available && update.new_version
					? html`<span class="os-plugins__next-version"> → ${ update.new_version }</span>`
					: '' }</span
			>
		</div>
		<footer class="os-plugins__module-footer">
			<div class="os-plugins__module-actions" aria-busy=${ updating || pending ? 'true' : 'false' }>
				${ actionsFor( host, ui, row ) }
			</div>
			<os-button
				variant="ghost"
				size="small"
				data-plugin-details
				aria-label=${ sprintf( /* translators: %s: plugin name */ __( 'Details for %s', 'desktop-mode' ), name ) }
				@click=${ open }
				>${ __( 'Details', 'desktop-mode' ) }<span aria-hidden="true"> ↗</span></os-button
			>
		</footer>
	</os-card>`;
}

/** The inspector keeps its tabs and scroll position across unrelated repaints. */
function detailPanel( ctx: Ctx, host: PluginsHost, ui: InstalledUi ): TemplateResult | string {
	const row = host.installed.find( ( r ) => r.plugin === ui.focused );
	if ( ! row ) {
		return '';
	}
	const key = JSON.stringify( row );
	const autoKey = JSON.stringify( [ row, host.busy.autoUpdating.has( row.plugin ) ] );
	if ( ui.autoUpdate?.key !== autoKey ) {
		ui.autoUpdate = { key: autoKey, node: renderAutoUpdateCell( host, row ) };
	}
	if ( ui.detail?.key !== key ) {
		const node = document.createElement( 'div' );
		node.className = 'os-plugins__inspector-content';
		const shadow = node.attachShadow( { mode: 'open' } );
		adoptStyles( shadow, 'plugins', DETAIL_STYLES );
		shadow.appendChild( buildInstalledDetail( row, host ) );
		ui.detail = { key, node };
	}
	return html`<aside
		class="os-plugins__inspector"
		aria-label=${ stripHtml( row.name ) || row.plugin }
		@keydown=${ ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Escape' ) {
				ev.stopPropagation();
				closeDetail( ctx, ui );
			}
		} }
	>
		<header class="os-plugins__inspector-bar">
			<os-button variant="ghost" size="small" data-plugin-back @click=${ () => closeDetail( ctx, ui ) }>
				<span aria-hidden="true">← </span>${ __( 'Library', 'desktop-mode' ) }
			</os-button>
			<span>${ stripHtml( row.name ) || row.plugin }</span>
		</header>
		<div class="os-plugins__module-actions">${ actionsFor( host, ui, row, 'inspector' ) }</div>
		${ host.extra.autoUpdatesEnabled
			? html`<div class="os-plugins__inspector-updates">
					<span>${ __( 'Automatic updates', 'desktop-mode' ) }</span>${ ui.autoUpdate.node }
				</div>`
			: '' }
		<div class="os-plugins__inspector-scroll">${ ui.detail.node }</div>
	</aside>`;
}

/** A bulk tray anchored outside the scrollable library, at every width. */
function selectionBar( ctx: Ctx, host: PluginsHost, ui: InstalledUi, rows: InstalledPlugin[] ): TemplateResult {
	const clear = (): void => {
		ui.selected = [];
		ctx.repaint();
	};
	const buttons = bulkButtons( host, ui.selected, clear );
	const busy = host.busy.updating.size > 0 || host.busy.optimistic.size > 0;
	return html`<div class="os-plugins__selection" ?hidden=${ ui.selected.length === 0 }>
		<os-checkbox
			label=${ __( 'Select visible', 'desktop-mode' ) }
			?checked=${ rows.length > 0 && rows.every( ( row ) => ui.selected.includes( row.plugin ) ) }
			?disabled=${ rows.length === 0 }
			@os-checkbox-change=${ ( ev: Event ) => {
				ui.selected = ( ev as CustomEvent<{ checked: boolean }> ).detail.checked ? rows.map( ( r ) => r.plugin ) : [];
				ctx.repaint();
			} }
		></os-checkbox>
		<span class="os-plugins__selection-count" role="status"
			>${ sprintf(
				/* translators: %d: selected plugins */ __( '%d selected', 'desktop-mode' ),
				ui.selected.length,
			) }</span
		>
		<div class="os-plugins__selection-actions">
			${ buttons.map(
				( b ) =>
					html`<os-button size="small" variant=${ b.variant } ?disabled=${ busy } @click=${ b.run }
						>${ b.label }</os-button
					>`,
			) }
		</div>
		<os-button
			variant="ghost"
			size="small"
			@click=${ () => {
				clear();
			} }
			>${ __( 'Done', 'desktop-mode' ) }</os-button
		>
	</div>`;
}

/** The Installed tab: a local, responsive library of the server's live plugins. */
export function installedPanel( ctx: Ctx, host: PluginsHost, ui: InstalledUi ): TemplateResult {
	const { state, data } = ctx;
	const rows = filterRows( data.installed, state.status, state.search, haystacksFor( data.installed, ui.haystacks ) );
	const visible = new Set( rows.map( ( r ) => r.plugin ) );
	ui.selected = ui.selected.filter( ( id ) => visible.has( id ) );
	if ( ! visible.has( ui.focused ) ) {
		ui.focused = '';
		ui.detail = null;
		ui.autoUpdate = null;
	}
	const installedIds = new Set( data.installed.map( ( r ) => r.plugin ) );
	for ( const id of ui.icons.keys() ) {
		if ( ! installedIds.has( id ) ) {
			ui.icons.delete( id );
		}
	}
	for ( const id of ui.controls.keys() ) {
		if ( ! installedIds.has( id.slice( id.indexOf( ':' ) + 1 ) ) ) {
			ui.controls.delete( id );
		}
	}
	rows.sort( ( a, b ) =>
		ui.sort === 'size'
			? ( b.openstation_size_kb ?? 0 ) - ( a.openstation_size_kb ?? 0 ) || a.name.localeCompare( b.name )
			: a.name.localeCompare( b.name ),
	);
	// Template arrays reconcile positionally. Moving a cached Node between
	// shelves lets the old slot dispose it after the new slot adopted it.
	// Reuse controls only while the layout is stable (selection, detail and
	// busy repaints); a new collection/order gets fresh nodes.
	const layoutKey = JSON.stringify( [ state.installedView, state.status, state.search, ui.sort, rows.map( ( row ) => [ row.plugin, pluginLane( row ) ] ) ] );
	if ( ui.layoutKey !== layoutKey ) {
		ui.layoutKey = layoutKey;
		ui.controls.clear();
		ui.icons.clear();
	}

	if ( ui.sort === 'attention' ) {
		const lanes = [ 'update', 'active', 'inactive' ];
		rows.sort( ( a, b ) => lanes.indexOf( pluginLane( a ) ) - lanes.indexOf( pluginLane( b ) ) );
	}
	ui.rows = rows;
	const updates = countUpdates( data.installed );
	const active = data.installed.filter( ( r ) => isActiveStatus( r.status ) ).length;
	const filters = [
		{ value: '', label: __( 'All plugins', 'desktop-mode' ), count: data.installed.length, icon: 'screenoptions' },
		{ value: 'update', label: __( 'Updates', 'desktop-mode' ), count: updates, icon: 'update' },
		{ value: 'active', label: __( 'Active', 'desktop-mode' ), count: active, icon: 'yes-alt' },
		{
			value: 'inactive',
			label: __( 'Inactive', 'desktop-mode' ),
			count: data.installed.length - active,
			icon: 'marker',
		},
	];
	const groups =
		ui.sort === 'attention' && ! state.status
			? [
				{
					id: 'update',
					title: __( 'Ready for an update', 'desktop-mode' ),
					hint: __( 'The next versions of your tools are here.', 'desktop-mode' ),
				},
				{
					id: 'active',
					title: __( 'Powering your site', 'desktop-mode' ),
					hint: __( 'Your everyday tools, switched on.', 'desktop-mode' ),
				},
				{
					id: 'inactive',
					title: __( 'On standby', 'desktop-mode' ),
					hint: __( 'Ready when you need them.', 'desktop-mode' ),
				},
			]
			: [
				{
					id: '',
					title:
							filters.find( ( f ) => f.value === state.status )?.label || __( 'All plugins', 'desktop-mode' ),
					hint: '',
				},
			];
	const reset = (): void => {
		state.status = '';
		state.search = '';
		ctx.repaint();
	};
	return html`<div class="os-plugins__workspace" data-view=${ state.installedView } data-detail-open=${ ui.focused ? 'true' : 'false' }><style>${ libraryStyles.cssText }</style>
		<div class="os-plugins__library">
			<header class="os-plugins__library-head">
				<div class="os-plugins__library-intro">
					<div>
						<span class="os-plugins__eyebrow">${ __( 'YOUR WORDPRESS, EXTENDED', 'desktop-mode' ) }</span>
						<h2>${ __( 'Make room for possibility.', 'desktop-mode' ) }</h2>
					</div>
					<os-button
						variant="ghost"
						size="small"
						os-action="reload"
						aria-label=${ __( 'Refresh plugins', 'desktop-mode' ) }
						title=${ __( 'Refresh plugins', 'desktop-mode' ) }
					>
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
				</div>
				<nav class="os-plugins__collections" aria-label=${ __( 'Filter plugins', 'desktop-mode' ) }>
					${ filters.map(
						( f ) =>
							html`<os-button
								class="os-plugins__collection"
								variant="ghost"
								data-filter=${ f.value || 'all' }
								aria-pressed=${ state.status === f.value ? 'true' : 'false' }
								@click=${ () => {
									state.status = f.value;
									ctx.repaint();
								} }
							>
								<span class="dashicons dashicons-${ f.icon }" aria-hidden="true"></span>
								<span>${ f.label }</span><strong>${ ctx.loading ? '—' : f.count }</strong>
							</os-button>`,
					) }
				</nav>
			</header>
			<div class="os-plugins__library-tools">
				<os-text-field
					id=${ `${ ctx.windowId }-plugins-search` }
					class="os-app-list__search"
					os-bind="search"
					os-debounce="200"
					value=${ state.search }
					aria-label=${ __( 'Search installed plugins', 'desktop-mode' ) }
					placeholder=${ __( 'Find a plugin or author…', 'desktop-mode' ) }
				></os-text-field>
				<os-select
					id=${ `${ ctx.windowId }-plugins-sort` }
					value=${ ui.sort }
					aria-label=${ __( 'Sort plugins', 'desktop-mode' ) }
					@os-pick=${ ( ev: Event ) => {
						ui.sort = ( ev as CustomEvent<{ value: string }> ).detail.value;
						ctx.repaint();
					} }
				>
					<os-option value="attention">${ __( 'Attention first', 'desktop-mode' ) }</os-option>
					<os-option value="name">${ __( 'Name A–Z', 'desktop-mode' ) }</os-option>
					<os-option value="size">${ __( 'Largest first', 'desktop-mode' ) }</os-option>
				</os-select>
				<div class="os-plugins__view-switch" role="group" aria-label=${ __( 'Plugin view', 'desktop-mode' ) } aria-busy=${ String( ui.savingView ) }>
					${ ( [ 'cards', 'table' ] as const ).map( ( view ) => html`<os-button size="small"
						variant=${ ! ctx.loading && state.installedView === view ? 'secondary' : 'ghost' }
						data-plugin-view=${ view } aria-pressed=${ String( ! ctx.loading && state.installedView === view ) }
						?disabled=${ ctx.loading || ui.savingView }
						@click=${ () => void changeInstalledView( ctx, ui, view ) }>
						<span class="dashicons dashicons-${ view === 'table' ? 'list-view' : 'grid-view' }" aria-hidden="true"></span>
						${ view === 'table' ? __( 'Table', 'desktop-mode' ) : __( 'Cards', 'desktop-mode' ) }
					</os-button>` ) }
				</div>
			</div>
			<div class="os-plugins__library-scroll" aria-busy=${ ctx.loading ? 'true' : 'false' }>
				${ data.error
					? html`<os-notice tone="error"
							>${ sprintf(
								/* translators: %s: error message */ __( 'Could not load plugins: %s', 'desktop-mode' ),
								data.error,
							) }</os-notice
						>`
					: '' }
				${ ctx.loading
					? html`<div class="os-plugins__loading" role="status">
							${ __( 'Opening your plugin library…', 'desktop-mode' ) }<os-progress-bar
								indeterminate
							></os-progress-bar>
						</div>`
					: '' }
				${ ! ctx.loading && ! rows.length && ! data.error
					? html`<div class="os-plugins__library-empty">
							<span class="dashicons dashicons-admin-plugins" aria-hidden="true"></span>
							<h3>
								${ data.installed.length
									? __( 'Nothing here. More possibilities elsewhere.', 'desktop-mode' )
									: __( 'Your next possibility starts here.', 'desktop-mode' ) }
							</h3>
							<p>${ __( 'Try another collection or a different search.', 'desktop-mode' ) }</p>
							<os-button variant="secondary" @click=${ reset }
								>${ __( 'Show all plugins', 'desktop-mode' ) }</os-button
							>
						</div>`
					: '' }
				${ state.installedView === 'table' ? html`<os-table data-os-plugins-table os-preserve
					aria-label=${ __( 'Installed plugins', 'desktop-mode' ) } selectable="multi" sticky-header sticky-columns="2" hover
					?hidden=${ ctx.loading || ! rows.length }></os-table>` : groups.map( ( group ) => {
					const members = group.id ? rows.filter( ( r ) => pluginLane( r ) === group.id ) : rows;
					return members.length
						? html`<section class="os-plugins__shelf" data-shelf=${ group.id } aria-label=${ group.title }>
								<div class="os-plugins__shelf-heading">
									<div>
										<h3>${ group.title } <span>${ members.length }</span></h3>
										<p ?hidden=${ ! group.hint }>${ group.hint }</p>
									</div>
									${ ( group.id === 'update' || state.status === 'update' ) && host.extra.caps.update
										? html`<os-button
												variant="secondary"
												size="small"
												@click=${ () => {
													ui.selected = [ ...new Set( [ ...ui.selected, ...members
														.filter( ( r ) => !! r.openstation_update_available?.package )
														.map( ( r ) => r.plugin ) ] ) ];
													ctx.repaint();
												} }
												>${ __( 'Select updates', 'desktop-mode' ) }</os-button
											>`
										: '' }
								</div>
								<os-grid class="os-plugins__module-grid" min-item-width="310" gap="12">
									${ members.map( ( row ) => pluginCard( ctx, host, ui, row ) ) }
								</os-grid>
							</section>`
						: '';
				} ) }
			</div>
			${ selectionBar( ctx, host, ui, rows ) }
		</div>
		${ detailPanel( ctx, host, ui ) }
	</div>`;
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
	if ( forced !== null || ! host.extra.caps.update ) {
		const label = document.createElement( 'span' );
		label.className = 'os-plugins__auto-update-fixed';
		label.textContent = ( forced ?? meta?.enabled )
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
			"This plugin does not check in with WordPress.org, so automatic updates can't be scheduled.",
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

/** Mirror the library's names and pressed state onto the kit's native controls. */
export function syncLibraryControls( root: HTMLElement ): void {
	queueMicrotask( () => {
		for ( const control of root.querySelectorAll(
			'.os-plugins__workspace os-button, .os-plugins__workspace os-text-field, .os-plugins__pick',
		) ) {
			const target = control.shadowRoot?.querySelector( 'button, input' );
			for ( const attr of [ 'aria-label', 'aria-pressed' ] ) {
				const value = control.getAttribute( attr );
				if ( value !== null ) {
					target?.setAttribute( attr, value );
				}
			}
		}
	} );
}

/** Load each plugin's icon once, with the existing directory fallback chain. */
function pluginIcon( ui: InstalledUi, row: InstalledPlugin ): HTMLElement {
	const key = JSON.stringify( [ row.name, row.openstation_icon_url ] );
	let cached = ui.icons.get( row.plugin );
	if ( ! cached || cached.key !== key ) {
		const node = document.createElement( 'span' );
		node.className = 'os-plugins__module-icon';
		node.setAttribute( 'aria-hidden', 'true' );
		const monogram = document.createElement( 'span' );
		monogram.className = 'os-plugins__monogram';
		monogram.textContent = ( stripHtml( row.name ) || row.plugin ).slice( 0, 2 ).toUpperCase();
		node.append( monogram );
		if ( row.openstation_icon_url ) {
			const img = document.createElement( 'img' );
			img.alt = '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.addEventListener( 'load', () => img.classList.add( 'is-loaded' ) );
			img.src = attachIconFallback( img, row.openstation_icon_url, () => img.remove() );
			node.append( img );
		}
		cached = { key, node };
		ui.icons.set( row.plugin, cached );
	}
	return cached.node;
}

/** Keep the table's imperative body in step with the same rows and selection as Cards. */
export function syncLibraryTable( ctx: Ctx, host: PluginsHost, ui: InstalledUi ): void {
	syncInstalledTable( ui.table, {
		root: ctx.root, host, rows: ui.rows, selected: ui.selected,
		onSelection: ( ids ) => {
			ui.selected = ids; ctx.repaint();
		},
		icon: ( row ) => pluginIcon( ui, row ),
		actions: ( row ) => actionsFor( host, ui, row, 'table' ),
		open: ( row ) => {
			ui.focused = row.plugin;
			ctx.repaint();
			queueMicrotask( () => ctx.root.querySelector( '[data-plugin-back]' )?.shadowRoot?.querySelector( 'button' )?.focus() );
		},
	} );
}
