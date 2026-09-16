/** Locate the best matching setting in the rendered Preferences pages. */
import { buildSearchIndex, pageRows } from './pages';
import { uiOf, type Ctx } from './types';

const CONTROLS = [
	'os-select', 'os-multiselect', 'os-segmented', 'os-swatch-grid', 'os-swatch',
	'os-checkbox-label', 'os-checkbox', 'os-switch', 'os-text-field',
	'os-number-field', 'os-range-field', 'os-color-field', 'os-textarea',
	'os-button', 'input', 'select', 'textarea', 'button',
].join( ',' );
const TEXT_ATTRIBUTES = [ 'label', 'aria-label', 'placeholder', 'description' ];
const MARKERS = [ 'data-settings-search-control', 'data-settings-search-section', 'data-settings-search-page' ];

interface SearchMatch {
	page: string;
	control: HTMLElement;
	section: HTMLElement | null;
}

/** Search text includes component labels that render inside shadow DOM. */
function textOf( el: Element ): string {
	const elements = [ el, ...el.querySelectorAll( '[label],[aria-label],[placeholder],[description]' ) ];
	return [ el.textContent ?? '', ...elements.flatMap( ( node ) => TEXT_ATTRIBUTES.map( ( name ) => node.getAttribute( name ) ?? '' ) ) ]
		.join( ' ' ).replace( /\s+/g, ' ' ).trim().toLowerCase();
}

/** Exact text outranks a prefix, which outranks a substring. */
function textScore( text: string, query: string ): number {
	text = text.replace( /\s+/g, ' ' ).trim().toLowerCase();
	if ( text === query ) {
		return 3;
	}
	return text.startsWith( query ) ? 2 : Number( text.includes( query ) );
}

/**
 * Rank control labels above option text, section headings and descriptions.
 * Keep the first control in page order on ties, so there is only one winner.
 * Hidden tab panels are searchable, but hidden controls within them are not.
 */
export function bestSearchMatch( root: HTMLElement, query: string ): SearchMatch | null {
	query = query.replace( /\s+/g, ' ' ).trim().toLowerCase();
	if ( ! query ) {
		return null;
	}
	let match: SearchMatch | null = null;
	let bestScore = 0;
	for ( const pane of root.querySelectorAll< HTMLElement >( '.os-settings > os-tabpanel' ) ) {
		for ( const control of pane.querySelectorAll< HTMLElement >( CONTROLS ) ) {
			// Composite controls (checkbox labels, pickers) are one setting.
			if ( control.parentElement?.closest( CONTROLS ) || control.closest( '[os-preserve]' ) ) {
				continue;
			}
			let hidden = false;
			for ( let el: HTMLElement | null = control; el && el !== pane; el = el.parentElement ) {
				if ( el.hidden || el.getAttribute( 'aria-hidden' ) === 'true' ) {
					hidden = true;
					break;
				}
			}
			if ( hidden ) {
				continue;
			}
			const section = control.closest< HTMLElement >( 'os-section' );
			const labelScore = Math.max(
				textScore( control.getAttribute( 'label' ) ?? '', query ),
				textScore( control.getAttribute( 'aria-label' ) ?? '', query ),
			);
			const score = Math.max(
				labelScore * 100,
				textScore( textOf( control ), query ) * 10,
				textScore( section?.getAttribute( 'heading' ) ?? '', query ) * 3,
				textScore( section?.getAttribute( 'description' ) ?? '', query ),
			);
			if ( score <= bestScore ) {
				continue;
			}
			bestScore = score;
			match = { page: pane.getAttribute( 'for' ) ?? '', control, section };
		}
	}
	return match;
}

/** Refresh the page index and navigate to the single best setting. */
export function searchSettings( ctx: Ctx, query: string ): void {
	// MIO uses the same entry point as typing. Keep its query visible,
	// without resetting the caret when the field itself triggered this call.
	const field = ctx.root.querySelector< HTMLInputElement >( '.os-settings__search-input' );
	if ( field && field.value !== query ) {
		field.value = query;
	}
	const search = uiOf( ctx ).search;
	search.index = buildSearchIndex( ctx.root, pageRows( ctx ) );
	search.query = query.replace( /\s+/g, ' ' ).trim().toLowerCase();
	const match = bestSearchMatch( ctx.root, search.query );
	if ( match && ctx.state.tab !== match.page ) {
		ctx.local( 'tab', { value: match.page } );
	} else {
		ctx.repaint();
	}
}

/** Reapply markers after a paint without stealing focus from the search. */
export function highlightSearchMatch( ctx: Ctx ): void {
	const previous = ctx.root.querySelector( '[data-settings-search-control]' );
	for ( const attr of MARKERS ) {
		for ( const el of ctx.root.querySelectorAll( `[${ attr }]` ) ) {
			el.removeAttribute( attr );
		}
	}
	const match = bestSearchMatch( ctx.root, uiOf( ctx ).search.query );
	if ( match && match.page === ctx.state.tab ) {
		match.control.setAttribute( MARKERS[ 0 ], '' );
		match.section?.setAttribute( MARKERS[ 1 ], '' );
		for ( const tab of ctx.root.querySelectorAll( '#os-settings-nav > os-tab' ) ) {
			if ( tab.getAttribute( 'value' ) === match.page ) {
				tab.setAttribute( MARKERS[ 2 ], '' );
			}
		}
		if ( previous !== match.control ) {
			// The tab strip reveals its panel in a queued component render.
			// Wait for layout, and abandon a result cleared before that frame.
			requestAnimationFrame( () => {
				if ( match.control.isConnected && match.control.hasAttribute( MARKERS[ 0 ] ) && ! match.control.closest( '[hidden]' ) ) {
					match.control.scrollIntoView?.( { block: 'nearest', inline: 'nearest', behavior: 'instant' } );
				}
			} );
		}
	}
}
