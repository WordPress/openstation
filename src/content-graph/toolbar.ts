import { __ } from '../i18n';
import type { GraphNode, GroupFacet, PostTypeDescriptor } from './types';

export interface ToolbarCallbacks {
	onTypesChange: ( types: string[] ) => void;
	onFitToView: () => void;
	onSearchSelect: ( node: GraphNode ) => void;
	onGroupChange: ( facet: GroupFacet | null ) => void;
	getNodes: () => GraphNode[];
}

const GROUP_NONE = 'none';

export interface ToolbarHandle {
	setStatus: ( text: string ) => void;

	updateCounts: ( types: PostTypeDescriptor[] ) => void;
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
	chipsRow.className = 'os-content-graph__filters';
	chipsRow.setAttribute( 'role', 'group' );
	chipsRow.setAttribute( 'aria-label', __( 'Show post types' ) );
	host.appendChild( chipsRow );

	for ( const type of postTypes ) {
		const chip = document.createElement( 'button' );
		chip.type = 'button';
		chip.className = 'os-content-graph__chip';
		chip.setAttribute( 'aria-pressed', 'true' );
		chip.dataset.slug = type.slug;
		chip.innerHTML =
			`<span class="dashicons ${ escapeAttr( type.icon ) }" aria-hidden="true"></span>` +
			`<span class="os-content-graph__chip-label">${ escapeHtml( type.label ) }</span>` +
			`<span class="os-content-graph__chip-count">${ type.count }</span>`;
		chip.addEventListener( 'click', () => {
			if ( active.has( type.slug ) ) {
				active.delete( type.slug );
			} else {
				active.add( type.slug );
			}
			chip.setAttribute( 'aria-pressed', String( active.has( type.slug ) ) );
			callbacks.onTypesChange( Array.from( active ) );
		} );
		chipsRow.appendChild( chip );
	}

	const searchWrap = document.createElement( 'div' );
	searchWrap.className = 'os-content-graph__search';
	const searchInput = document.createElement( 'os-text-field' );
	searchInput.setAttribute( 'type', 'search' );
	searchInput.setAttribute(
		'label',
		__( 'Search posts and pages in the graph' ),
	);
	searchInput.setAttribute( 'hide-label', '' );
	searchInput.setAttribute( 'clearable', '' );
	searchInput.setAttribute( 'placeholder', __( 'Search nodes…' ) );
	searchWrap.appendChild( searchInput );

	const dropdown = document.createElement( 'ul' );
	dropdown.className = 'os-content-graph__search-results';
	dropdown.hidden = true;
	searchWrap.appendChild( dropdown );

	host.appendChild( searchWrap );

	const searchValue = (): string =>
		( searchInput as HTMLElement & { value?: string } ).value ?? '';

	const handleSearchInput = (): void => {
		const q = searchValue().trim().toLowerCase();
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
			btn.className = 'os-content-graph__search-result';
			btn.innerHTML =
				`<span class="os-content-graph__search-title">${ escapeHtml( m.title || '#' + m.id ) }</span>` +
				`<span class="os-content-graph__search-type">${ escapeHtml( m.type ) }</span>`;
			btn.addEventListener( 'click', () => {
				( searchInput as HTMLElement & { value?: string } ).value = '';
				dropdown.hidden = true;
				dropdown.replaceChildren();
				callbacks.onSearchSelect( m );
			} );
			li.appendChild( btn );
			dropdown.appendChild( li );
		}
		dropdown.hidden = matches.length === 0;
	};

	searchInput.addEventListener( 'os-input-change', handleSearchInput );
	searchInput.addEventListener( 'focusin', handleSearchInput );
	searchInput.addEventListener( 'focusout', () => {
		setTimeout( () => {
			dropdown.hidden = true;
		}, 120 );
	} );

	const groupBy = document.createElement( 'os-select' );
	groupBy.className = 'os-content-graph__group-by';
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
		const opt = document.createElement( 'os-option' );
		opt.setAttribute( 'value', value );
		opt.textContent = label;
		groupBy.appendChild( opt );
	}
	groupBy.addEventListener( 'os-pick', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		const raw = detail?.value ?? GROUP_NONE;
		const facet: GroupFacet | null =
			raw === GROUP_NONE ? null : ( raw as GroupFacet );
		callbacks.onGroupChange( facet );
	} );

	host.insertBefore( groupBy, searchWrap );

	const actions = document.createElement( 'div' );
	actions.className = 'os-content-graph__actions';

	const fit = document.createElement( 'os-button' );
	fit.setAttribute( 'variant', 'ghost' );
	fit.innerHTML =
		'<span class="dashicons dashicons-editor-expand" aria-hidden="true"></span>' +
		`<span>${ escapeHtml( __( 'Fit' ) ) }</span>`;
	fit.title = __( 'Fit graph to view' );
	fit.addEventListener( 'click', () => callbacks.onFitToView() );
	actions.appendChild( fit );

	const status = document.createElement( 'span' );
	status.className = 'os-content-graph__toolbar-status';
	status.setAttribute( 'role', 'status' );
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
		updateCounts: ( types: PostTypeDescriptor[] ) => {
			for ( const type of types ) {
				const badge = chipsRow.querySelector< HTMLElement >(
					`.os-content-graph__chip[data-slug="${ escapeAttr( type.slug ) }"] .os-content-graph__chip-count`,
				);
				if ( badge ) {
					badge.textContent = String( type.count ?? 0 );
				}
			}
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
