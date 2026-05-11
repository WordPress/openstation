/**
 * Content Graph — toolbar.
 *
 * Top strip of the window. As of 0.9.0 the toolbar is composed
 * entirely of `<wpd-*>` components (per AGENTS.md "Use wpd-*
 * components, not raw HTML controls"). It exposes:
 *
 *   1. **Lens picker** — `<wpd-segmented>` switching between
 *      Constellation and Galaxy.
 *   2. **Taxonomy picker** — `<wpd-select>` choosing the Galaxy
 *      clustering taxonomy. Visible only when the active lens is
 *      Galaxy.
 *   3. **Post-type chips** — `<wpd-chip>` row, one per public post
 *      type. Click toggles inclusion in the build.
 *   4. **Edges multi-toggle** — `<wpd-multiselect>` controlling which
 *      edge kinds render. Default-on/off varies by lens (R12).
 *   5. **Search** — fuzzy match on node titles. Selecting a result
 *      tells the host to focus that node. Kept as a raw input
 *      because it owns its own results dropdown which doesn't yet
 *      have a native `<wpd-*>` analogue.
 *   6. **Action buttons** — `<wpd-button>` for fit-to-view. Status
 *      text reports node/edge counts.
 *
 * @public
 * @since 0.8.2
 * @since 0.9.0 wpd-* migration; lens/taxonomy/edges controls.
 */

import { __ } from '../i18n';
import type {
	EdgeKind,
	EdgeKindDescriptor,
	GraphNode,
	LensId,
	PostTypeDescriptor,
	TaxonomyDescriptor,
} from './types';

export interface ToolbarCallbacks {
	onTypesChange: ( types: string[] ) => void;
	onLensChange: ( lens: LensId ) => void;
	onTaxonomyChange: ( taxonomySlug: string ) => void;
	onEdgesChange: ( edges: EdgeKind[] ) => void;
	onFitToView: () => void;
	onSearchSelect: ( node: GraphNode ) => void;
	getNodes: () => GraphNode[];
}

export interface ToolbarHandle {
	setStatus: ( text: string ) => void;
	setActiveLens: ( lens: LensId ) => void;
	setActiveTaxonomy: ( slug: string ) => void;
	setActiveEdges: ( edges: EdgeKind[] ) => void;
	setActiveTypes: ( types: string[] ) => void;
	destroy: () => void;
}

export interface ToolbarInitialState {
	lens: LensId;
	types: string[];
	taxonomy: string;
	edges: EdgeKind[];
}

export function renderToolbar(
	host: HTMLElement,
	postTypes: PostTypeDescriptor[],
	taxonomies: TaxonomyDescriptor[],
	edgeKinds: EdgeKindDescriptor[],
	initial: ToolbarInitialState,
	callbacks: ToolbarCallbacks,
): ToolbarHandle {
	host.replaceChildren();

	// --- Lens picker ----------------------------------------------------
	const lensPicker = document.createElement( 'wpd-segmented' );
	lensPicker.setAttribute( 'label', __( 'Lens' ) );
	lensPicker.setAttribute( 'value', initial.lens );
	( lensPicker as unknown as {
		items: ReadonlyArray< { value: string; label: string } >;
	} ).items = [
		{ value: 'constellation', label: __( 'Constellation' ) },
		{ value: 'galaxy', label: __( 'Galaxy' ) },
	];
	lensPicker.addEventListener( 'wpd-pick', ( evt: Event ) => {
		const detail = ( evt as CustomEvent< { value: string } > ).detail;
		const next = detail.value as LensId;
		applyLensVisibility( next );
		callbacks.onLensChange( next );
	} );
	host.appendChild( lensPicker );

	// --- Taxonomy dropdown (Galaxy only) --------------------------------
	const taxonomyWrap = document.createElement( 'div' );
	taxonomyWrap.className = 'desktop-mode-content-graph__taxonomy';
	const taxonomyPicker = document.createElement( 'wpd-select' );
	taxonomyPicker.setAttribute( 'label', __( 'Cluster by' ) );
	taxonomyPicker.setAttribute( 'value', initial.taxonomy );
	( taxonomyPicker as unknown as {
		items: ReadonlyArray< { value: string; label: string } >;
	} ).items = taxonomies.map( ( t ) => ( {
		value: t.slug,
		label: t.label,
	} ) );
	taxonomyPicker.addEventListener( 'wpd-pick', ( evt: Event ) => {
		const detail = ( evt as CustomEvent< { value: string } > ).detail;
		callbacks.onTaxonomyChange( detail.value );
	} );
	taxonomyWrap.appendChild( taxonomyPicker );
	host.appendChild( taxonomyWrap );

	// --- Post-type chip row ---------------------------------------------
	const activeTypes = new Set(
		initial.types.length > 0
			? initial.types
			: postTypes.map( ( t ) => t.slug ),
	);
	const chipsRow = document.createElement( 'div' );
	chipsRow.className = 'desktop-mode-content-graph__filters';
	host.appendChild( chipsRow );

	const chipByType = new Map< string, HTMLElement >();
	for ( const type of postTypes ) {
		const chip = document.createElement( 'wpd-chip' );
		chip.setAttribute( 'label', `${ type.label } (${ type.count })` );
		chip.setAttribute(
			'tone',
			activeTypes.has( type.slug ) ? 'accent' : 'neutral',
		);
		chip.dataset.slug = type.slug;
		chip.style.cursor = 'pointer';
		chip.addEventListener( 'click', () => {
			if ( activeTypes.has( type.slug ) ) {
				activeTypes.delete( type.slug );
				chip.setAttribute( 'tone', 'neutral' );
			} else {
				activeTypes.add( type.slug );
				chip.setAttribute( 'tone', 'accent' );
			}
			callbacks.onTypesChange( Array.from( activeTypes ) );
		} );
		chipsRow.appendChild( chip );
		chipByType.set( type.slug, chip );
	}

	// --- Edges multi-toggle ---------------------------------------------
	const activeEdges = new Set< EdgeKind >( initial.edges );
	const edgesPicker = document.createElement( 'wpd-multiselect' );
	edgesPicker.setAttribute( 'label', __( 'Edges' ) );
	edgesPicker.setAttribute(
		'value',
		Array.from( activeEdges ).join( ',' ),
	);
	( edgesPicker as unknown as {
		items: ReadonlyArray< { value: string; label: string } >;
	} ).items = edgeKinds.map( ( k ) => ( {
		value: k.slug,
		label: k.label,
	} ) );
	edgesPicker.addEventListener( 'wpd-pick', ( evt: Event ) => {
		const detail = (
			evt as CustomEvent< { value: string; values: string[] } >
		).detail;
		const next = detail.values as EdgeKind[];
		activeEdges.clear();
		for ( const k of next ) {
			activeEdges.add( k );
		}
		callbacks.onEdgesChange( Array.from( activeEdges ) );
	} );
	host.appendChild( edgesPicker );

	// --- Search (kept as raw input + result list) -----------------------
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

	// --- Actions row ----------------------------------------------------
	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-content-graph__actions';

	const fit = document.createElement( 'wpd-button' );
	fit.setAttribute( 'label', __( 'Fit' ) );
	fit.setAttribute( 'icon', 'editor-expand' );
	fit.setAttribute( 'variant', 'tertiary' );
	fit.title = __( 'Fit graph to view' );
	fit.addEventListener( 'click', () => callbacks.onFitToView() );
	actions.appendChild( fit );

	const status = document.createElement( 'span' );
	status.className = 'desktop-mode-content-graph__toolbar-status';
	actions.appendChild( status );

	host.appendChild( actions );

	// Apply initial lens-driven visibility.
	function applyLensVisibility( lens: LensId ): void {
		taxonomyWrap.hidden = lens !== 'galaxy';
	}
	applyLensVisibility( initial.lens );

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
		setActiveLens: ( lens: LensId ) => {
			lensPicker.setAttribute( 'value', lens );
			applyLensVisibility( lens );
		},
		setActiveTaxonomy: ( slug: string ) => {
			taxonomyPicker.setAttribute( 'value', slug );
		},
		setActiveEdges: ( edges: EdgeKind[] ) => {
			activeEdges.clear();
			for ( const k of edges ) {
				activeEdges.add( k );
			}
			edgesPicker.setAttribute( 'value', edges.join( ',' ) );
		},
		setActiveTypes: ( types: string[] ) => {
			activeTypes.clear();
			for ( const t of types ) {
				activeTypes.add( t );
			}
			for ( const [ slug, chip ] of chipByType ) {
				chip.setAttribute(
					'tone',
					activeTypes.has( slug ) ? 'accent' : 'neutral',
				);
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
