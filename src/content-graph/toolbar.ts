/**
 * Content Graph — toolbar.
 *
 * Top strip of the window. Three pieces:
 *
 *   1. **Filter chips** — one per public post type. Click to toggle;
 *      the host re-fetches `/nodes` with the active set.
 *   2. **Search** — fuzzy match on node titles. Selecting a result
 *      tells the host to focus that node.
 *   3. **Action buttons** — fit-to-view + reheat the simulation.
 *
 * @public
 * @since 0.8.2
 */

import { __ } from '../i18n';
import type { GraphNode, GroupFacet, PostTypeDescriptor } from './types';

export interface ToolbarCallbacks {
	onTypesChange: ( types: string[] ) => void;
	onFitToView: () => void;
	onSearchSelect: ( node: GraphNode ) => void;
	onGroupChange: ( facet: GroupFacet | null ) => void;
	getNodes: () => GraphNode[];
}

// Sentinel for the "no clustering" option. `<wpd-select>` works
// best with non-empty values; the toolbar maps it to `null` before
// handing it to the orchestrator.
const GROUP_NONE = 'none';

export interface ToolbarHandle {
	setStatus: ( text: string ) => void;
	destroy: () => void;
}

export function renderToolbar(
	host: HTMLElement,
	postTypes: PostTypeDescriptor[],
	callbacks: ToolbarCallbacks,
): ToolbarHandle {
	host.replaceChildren();

	const active = new Set( postTypes.map( ( t ) => t.slug ) );

	const chipsRow = document.createElement( 'div' );
	chipsRow.className = 'desktop-mode-content-graph__filters';
	host.appendChild( chipsRow );

	for ( const type of postTypes ) {
		const chip = document.createElement( 'button' );
		chip.type = 'button';
		chip.className = 'desktop-mode-content-graph__chip is-active';
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

	host.appendChild( searchWrap );

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
		// Delay so click on a result still registers.
		setTimeout( () => {
			dropdown.hidden = true;
		}, 120 );
	} );

	// Group-by select lives next to the filter chips so it reads as a
	// peer control ("filter, then group"). It's a direct child of the
	// toolbar — NOT inside `actions` — because actions has `margin-left:
	// auto` and would shove the select to the right edge, away from
	// the chips it groups.
	//
	// Deliberately no `label` attribute: `<wpd-select>` renders its
	// label stacked above the dropdown, which makes the control
	// taller than the chips and breaks horizontal alignment on the
	// toolbar row. Instead, the first option's text ("No grouping")
	// telegraphs the purpose, with `aria-label` + `title` carrying
	// the "Group by" semantics for screen readers and hover.
	const groupBy = document.createElement( 'wpd-select' );
	groupBy.className = 'desktop-mode-content-graph__group-by';
	groupBy.setAttribute( 'value', GROUP_NONE );
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
	// Sit between chips and search so it lines up with the filter
	// chips on the same row.
	host.insertBefore( groupBy, searchWrap );

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

	const status = document.createElement( 'span' );
	status.className = 'desktop-mode-content-graph__toolbar-status';
	actions.appendChild( status );

	host.appendChild( actions );

	const onDocClick = ( ev: Event ): void => {
		if ( ! searchWrap.contains( ev.target as Node ) ) {
			dropdown.hidden = true;
		}
	};
	document.addEventListener( 'click', onDocClick );

	return {
		setStatus: ( text: string ) => {
			status.textContent = text;
		},
		destroy: () => {
			document.removeEventListener( 'click', onDocClick );
		},
	};
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
