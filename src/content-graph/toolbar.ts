/**
 * Content Graph — toolbar.
 *
 * Top strip of the window. Houses the View toggle (`Graph` / `Galaxy`)
 * plus the view-specific controls below it:
 *
 *   - **Graph view** — post-type filter chips, Group-by select, search.
 *   - **Galaxy view** — tabs (All / Drafts / Recent), Group-by select,
 *     MIN VOLUME + ZOOM range sliders, visible-count readout, search.
 *
 * The user's last chosen view is persisted via the
 * `desktop_mode_content_graph_view` user meta key (registered in
 * `includes/content-graph/window.php`). The bundle reads it on mount
 * from `cfg.lastView` and writes back via `POST /wp/v2/users/<id>`
 * whenever the segmented control flips.
 *
 * @public
 * @since 0.8.2
 */

import { __, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import { joinRestUrl } from '../rest-url';
// Side-effect imports register the `<wpd-*>` custom elements this
// toolbar constructs. Without them the elements render as inert
// (un-upgraded) custom elements. See ESLint local rule
// `wpd-component-registration` for the contract.
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-tabs/wpd-tabs';
import '../ui/components/wpd-range-field/wpd-range-field';
import type {
	ContentGraphConfig,
	GalaxyTab,
	GraphNode,
	GroupFacet,
	PostTypeDescriptor,
} from './types';

export type ContentGraphView = 'graph' | 'galaxy';

export interface ToolbarCallbacks {
	onTypesChange: ( types: string[] ) => void;
	onFitToView: () => void;
	onSearchSelect: ( node: GraphNode ) => void;
	onGroupChange: ( facet: GroupFacet | null ) => void;
	getNodes: () => GraphNode[];
	onViewChange: ( view: ContentGraphView ) => void;
	onGalaxyTabChange: ( tab: GalaxyTab ) => void;
	onMinCommentsChange: ( min: number ) => void;
	onZoomChange: ( zoom: number ) => void;
}

// Sentinel for the "no clustering" option. `<wpd-select>` works
// best with non-empty values; the toolbar maps it to `null` before
// handing it to the orchestrator.
const GROUP_NONE = 'none';

export interface ToolbarHandle {
	setStatus: ( text: string ) => void;
	setVisibleCount: ( visible: number, total: number ) => void;
	getView: () => ContentGraphView;
	destroy: () => void;
}

export function renderToolbar(
	host: HTMLElement,
	cfg: ContentGraphConfig,
	postTypes: PostTypeDescriptor[],
	callbacks: ToolbarCallbacks,
): ToolbarHandle {
	host.replaceChildren();

	let view: ContentGraphView = cfg.lastView === 'galaxy' ? 'galaxy' : 'graph';
	// Survives mode-row rebuilds (Graph ⇄ Galaxy swaps): the freshly
	// constructed group-by select initialises to this value so the
	// dropdown keeps showing the facet that is actually active in the
	// scene instead of resetting to "No grouping".
	let currentFacet: GroupFacet | null = null;
	const active = new Set( postTypes.map( ( t ) => t.slug ) );

	// Row A — always visible. View toggle on the left, status on the right.
	const headerRow = document.createElement( 'div' );
	headerRow.className = 'desktop-mode-content-graph__header-row';

	const viewToggle = document.createElement( 'wpd-segmented' );
	viewToggle.setAttribute( 'aria-label', __( 'View mode' ) );
	viewToggle.setAttribute( 'value', view );
	for ( const [ value, label ] of [
		[ 'graph', __( 'Graph' ) ],
		[ 'galaxy', __( 'Galaxy' ) ],
	] as const ) {
		const seg = document.createElement( 'wpd-segment' );
		seg.setAttribute( 'value', value );
		seg.textContent = label;
		viewToggle.appendChild( seg );
	}
	viewToggle.addEventListener( 'wpd-pick', ( ev: Event ) => {
		const next = ( ev as CustomEvent< { value: string } > ).detail?.value;
		if ( next !== 'graph' && next !== 'galaxy' ) {
			return;
		}
		if ( next === view ) {
			return;
		}
		view = next;
		void persistView( cfg, view );
		rebuildModeRow();
		callbacks.onViewChange( view );
	} );
	headerRow.appendChild( viewToggle );

	const status = document.createElement( 'span' );
	status.className = 'desktop-mode-content-graph__toolbar-status';
	headerRow.appendChild( status );

	host.appendChild( headerRow );

	// Row B — view-specific. Rebuilt on mode flip.
	const modeRow = document.createElement( 'div' );
	modeRow.className = 'desktop-mode-content-graph__mode-row';
	host.appendChild( modeRow );

	// Cached node-count widget — only meaningful in Galaxy view but
	// owned at the toolbar level so the scene can push updates without
	// caring which row is currently mounted.
	let visibleCountEl: HTMLSpanElement | null = null;

	// Wrap the host callbacks so the toolbar can track the active facet
	// across mode-row rebuilds without the host needing to know.
	const trackedCallbacks: ToolbarCallbacks = {
		...callbacks,
		onGroupChange: ( facet ) => {
			currentFacet = facet;
			callbacks.onGroupChange( facet );
		},
	};

	const rebuildModeRow = (): void => {
		modeRow.replaceChildren();
		visibleCountEl = null;
		if ( view === 'graph' ) {
			renderGraphChrome(
				modeRow,
				postTypes,
				active,
				trackedCallbacks,
				currentFacet,
			);
			return;
		}
		visibleCountEl = renderGalaxyChrome(
			modeRow,
			trackedCallbacks,
			currentFacet,
		);
	};
	rebuildModeRow();

	return {
		setStatus: ( text: string ) => {
			status.textContent = text;
		},
		setVisibleCount: ( visible: number, total: number ) => {
			if ( ! visibleCountEl ) {
				return;
			}
			// Right-aligned widget below the canvas-overlay tab strip;
			// mirrors the reference image's "X of Y visible" readout.
			// One translatable template (not concatenated fragments) so
			// translators can reorder; the template is escaped before
			// our own <strong> markup is substituted in.
			visibleCountEl.innerHTML = sprintf(
				/* translators: 1: number of visible posts. 2: total number of posts loaded. */
				escapeHtml( __( '%1$s of %2$s visible' ) ),
				'<strong>' + String( visible ) + '</strong>',
				String( total ),
			);
		},
		getView: () => view,
		destroy: () => {
			// All toolbar listeners are element-scoped and die with the
			// host DOM — nothing document-level to detach.
		},
	};
}

function renderGraphChrome(
	row: HTMLElement,
	postTypes: PostTypeDescriptor[],
	active: Set< string >,
	callbacks: ToolbarCallbacks,
	currentFacet: GroupFacet | null,
): void {
	const chipsRow = document.createElement( 'div' );
	chipsRow.className = 'desktop-mode-content-graph__filters';
	row.appendChild( chipsRow );

	for ( const type of postTypes ) {
		const chip = document.createElement( 'button' );
		chip.type = 'button';
		chip.className = active.has( type.slug )
			? 'desktop-mode-content-graph__chip is-active'
			: 'desktop-mode-content-graph__chip';
		chip.dataset.slug = type.slug;
		chip.innerHTML =
			`<span class="dashicons ${ escapeAttr( type.icon ) }" aria-hidden="true"></span>` +
			`<span class="desktop-mode-content-graph__chip-label">${ escapeHtml( type.label ) }</span>` +
			`<span class="desktop-mode-content-graph__chip-count">${ type.count }</span>`;
		chip.addEventListener( 'click', () => {
			if ( active.has( type.slug ) ) {
				active.delete( type.slug );
				chip.classList.remove( 'is-active' );
			} else {
				active.add( type.slug );
				chip.classList.add( 'is-active' );
			}
			callbacks.onTypesChange( Array.from( active ) );
		} );
		chipsRow.appendChild( chip );
	}

	const groupBy = buildGroupBySelect( callbacks, currentFacet );
	row.appendChild( groupBy );

	const searchWrap = buildSearch( callbacks );
	row.appendChild( searchWrap );

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-content-graph__actions';

	const fit = document.createElement( 'button' );
	fit.type = 'button';
	fit.className = 'desktop-mode-content-graph__btn';
	fit.innerHTML =
		'<span class="dashicons dashicons-editor-expand" aria-hidden="true"></span>' +
		`<span>${ escapeHtml( __( 'Fit' ) ) }</span>`;
	fit.title = __( 'Fit graph to view' );
	fit.addEventListener( 'click', () => callbacks.onFitToView() );
	actions.appendChild( fit );

	row.appendChild( actions );
}

function renderGalaxyChrome(
	row: HTMLElement,
	callbacks: ToolbarCallbacks,
	currentFacet: GroupFacet | null,
): HTMLSpanElement {
	const tabs = document.createElement( 'wpd-tabs' );
	tabs.setAttribute( 'value', 'all' );
	tabs.setAttribute( 'aria-label', __( 'Filter by status' ) );
	for ( const [ value, label ] of [
		[ 'all', __( 'All' ) ],
		[ 'drafts', __( 'Drafts' ) ],
		[ 'recent', __( 'Recent' ) ],
	] as const ) {
		const tab = document.createElement( 'wpd-tab' );
		tab.setAttribute( 'value', value );
		tab.textContent = label;
		tabs.appendChild( tab );
	}
	tabs.addEventListener( 'wpd-tab-change', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		const v = detail?.value;
		if ( v === 'all' || v === 'drafts' || v === 'recent' ) {
			callbacks.onGalaxyTabChange( v );
		}
	} );
	row.appendChild( tabs );

	const groupBy = buildGroupBySelect( callbacks, currentFacet );
	row.appendChild( groupBy );

	const minVol = document.createElement( 'wpd-range-field' );
	minVol.setAttribute( 'label', __( 'Min comments' ) );
	minVol.setAttribute( 'value', '0' );
	minVol.setAttribute( 'min', '0' );
	minVol.setAttribute( 'max', '50' );
	minVol.setAttribute( 'step', '1' );
	minVol.className = 'desktop-mode-content-graph__range';
	minVol.addEventListener( 'wpd-range-change', ( ev: Event ) => {
		const v = ( ev as CustomEvent< { value: number } > ).detail?.value;
		if ( typeof v === 'number' ) {
			callbacks.onMinCommentsChange( v );
		}
	} );
	row.appendChild( minVol );

	const zoom = document.createElement( 'wpd-range-field' );
	zoom.setAttribute( 'label', __( 'Zoom' ) );
	zoom.setAttribute( 'value', '100' );
	// Floor of 10% — a grouped fit-to-view regularly settles well below
	// 50% (ZOOM_MIN in the scene is 8%), and a slider floor far above
	// the fitted scale made the first slider touch jump the camera ~5×.
	zoom.setAttribute( 'min', '10' );
	zoom.setAttribute( 'max', '400' );
	zoom.setAttribute( 'step', '5' );
	zoom.setAttribute( 'suffix', '%' );
	zoom.className = 'desktop-mode-content-graph__range';
	zoom.addEventListener( 'wpd-range-change', ( ev: Event ) => {
		const v = ( ev as CustomEvent< { value: number } > ).detail?.value;
		if ( typeof v === 'number' ) {
			callbacks.onZoomChange( v / 100 );
		}
	} );
	row.appendChild( zoom );

	const searchWrap = buildSearch( callbacks );
	row.appendChild( searchWrap );

	const visibleCount = document.createElement( 'span' );
	visibleCount.className = 'desktop-mode-content-graph__visible-count';
	row.appendChild( visibleCount );

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-content-graph__actions';

	const fit = document.createElement( 'button' );
	fit.type = 'button';
	fit.className = 'desktop-mode-content-graph__btn';
	fit.innerHTML =
		'<span class="dashicons dashicons-editor-expand" aria-hidden="true"></span>' +
		`<span>${ escapeHtml( __( 'Fit' ) ) }</span>`;
	fit.title = __( 'Fit graph to view' );
	fit.addEventListener( 'click', () => callbacks.onFitToView() );
	actions.appendChild( fit );
	row.appendChild( actions );

	return visibleCount;
}

function buildGroupBySelect(
	callbacks: ToolbarCallbacks,
	currentFacet: GroupFacet | null,
): HTMLElement {
	const groupBy = document.createElement( 'wpd-select' );
	groupBy.className = 'desktop-mode-content-graph__group-by';
	groupBy.setAttribute( 'value', currentFacet ?? GROUP_NONE );
	groupBy.setAttribute( 'aria-label', __( 'Group by' ) );
	groupBy.title = __( 'Group posts by a shared facet' );
	for ( const [ value, label ] of [
		[ GROUP_NONE, __( 'No grouping' ) ],
		[ 'category', __( 'Group by category' ) ],
		[ 'tag', __( 'Group by tag' ) ],
		[ 'author', __( 'Group by author' ) ],
		[ 'year', __( 'Group by year' ) ],
		[ 'year_month', __( 'Group by year-month' ) ],
	] as const ) {
		const opt = document.createElement( 'wpd-option' );
		opt.setAttribute( 'value', value );
		opt.textContent = label;
		groupBy.appendChild( opt );
	}
	groupBy.addEventListener( 'wpd-pick', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		const raw = detail?.value ?? GROUP_NONE;
		const facet: GroupFacet | null =
			raw === GROUP_NONE ? null : ( raw as GroupFacet );
		callbacks.onGroupChange( facet );
	} );
	return groupBy;
}

function buildSearch( callbacks: ToolbarCallbacks ): HTMLElement {
	const searchWrap = document.createElement( 'div' );
	searchWrap.className = 'desktop-mode-content-graph__search';
	const searchInput = document.createElement( 'input' );
	searchInput.type = 'search';
	searchInput.className = 'desktop-mode-content-graph__search-input';
	searchInput.placeholder = __( 'Search nodes…' );
	searchInput.setAttribute(
		'aria-label',
		__( 'Search posts and pages in the graph' ),
	);
	searchWrap.appendChild( searchInput );

	const dropdown = document.createElement( 'ul' );
	dropdown.className = 'desktop-mode-content-graph__search-results';
	dropdown.hidden = true;
	searchWrap.appendChild( dropdown );

	const handleSearchInput = (): void => {
		const q = searchInput.value.trim().toLowerCase();
		if ( q.length === 0 ) {
			dropdown.hidden = true;
			dropdown.replaceChildren();
			return;
		}
		const matches = callbacks
			.getNodes()
			.filter( ( n ) => n.title.toLowerCase().includes( q ) )
			.slice( 0, 10 );
		dropdown.replaceChildren();
		for ( const m of matches ) {
			const li = document.createElement( 'li' );
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'desktop-mode-content-graph__search-result';
			btn.innerHTML =
				`<span class="desktop-mode-content-graph__search-title">${ escapeHtml( m.title || '#' + m.id ) }</span>` +
				`<span class="desktop-mode-content-graph__search-type">${ escapeHtml( m.type ) }</span>`;
			btn.addEventListener( 'click', () => {
				searchInput.value = '';
				dropdown.hidden = true;
				dropdown.replaceChildren();
				callbacks.onSearchSelect( m );
			} );
			li.appendChild( btn );
			dropdown.appendChild( li );
		}
		dropdown.hidden = matches.length === 0;
	};
	searchInput.addEventListener( 'input', handleSearchInput );
	searchInput.addEventListener( 'focus', handleSearchInput );
	searchInput.addEventListener( 'blur', () => {
		setTimeout( () => {
			dropdown.hidden = true;
		}, 120 );
	} );

	return searchWrap;
}

/**
 * Save the user's chosen view to `desktop_mode_content_graph_view`
 * user meta. Silent: failures stay client-side (we still respect the
 * choice for this session via the in-memory `view` variable). Future
 * window opens fall back to the last successful save, or `'graph'`.
 */
async function persistView(
	cfg: ContentGraphConfig,
	value: ContentGraphView,
): Promise< void > {
	const userId = cfg.currentUserId ?? 0;
	if ( userId <= 0 ) {
		return;
	}
	try {
		await trackedFetch(
			joinRestUrl( cfg.restRoot, `wp/v2/users/${ userId }` ),
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
				body: JSON.stringify( {
					meta: {
						desktop_mode_content_graph_view: value,
					},
				} ),
			},
			{ source: 'desktop-mode/content-graph', silent: true },
		);
	} catch {
		// Non-fatal — in-memory state still reflects the user's choice.
	}
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function escapeAttr( s: string ): string {
	return s.replace( /[^a-zA-Z0-9 _\-]/g, '' );
}
