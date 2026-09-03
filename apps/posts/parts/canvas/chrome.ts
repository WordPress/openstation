/**
 * Posts app — the HTML chrome around a term canvas: the toolbar (its
 * buttons, the fuzzy-search box, the hint), the stage the canvas
 * paints into, the sidebar editor column, and the search dropdown's
 * keyboard + mouse wiring. The two canvases differ only by their
 * class prefix and their buttons.
 *
 * @public
 */

import { _n, sprintf } from '../../../../src/i18n';

export interface ChromeButton {
	className: string;
	icon: string;
	label: string;
	title?: string;
}

export interface CanvasChrome {
	toolbar: HTMLElement;
	stage: HTMLElement;
	sidebar: HTMLElement;
	buttons: HTMLButtonElement[];
	searchWrap: HTMLElement;
	searchInput: HTMLInputElement;
	searchResults: HTMLUListElement;
}

/**
 * Build the chrome into `host`. The stage starts `is-loading`
 * (opacity 0) until the first fit-to-view, so the canvas never
 * flashes its unfitted transform.
 */
export function buildCanvasChrome(
	host: HTMLElement,
	prefix: string,
	opts: { buttons: ChromeButton[]; searchPlaceholder: string; searchAria: string; hint: string },
): CanvasChrome {
	host.replaceChildren();
	host.classList.add( prefix );

	const toolbar = document.createElement( 'div' );
	toolbar.className = `${ prefix }__toolbar`;
	const buttons = opts.buttons.map( ( b ) => {
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = b.className;
		btn.innerHTML = `<span class="dashicons ${ b.icon }" aria-hidden="true"></span>` + b.label;
		if ( b.title ) {
			btn.title = b.title;
		}
		toolbar.appendChild( btn );
		return btn;
	} );
	const searchWrap = document.createElement( 'div' );
	searchWrap.className = `${ prefix }__search`;
	const searchInput = document.createElement( 'input' );
	searchInput.type = 'search';
	searchInput.className = `${ prefix }__search-input`;
	searchInput.placeholder = opts.searchPlaceholder;
	searchInput.setAttribute( 'aria-label', opts.searchAria );
	searchWrap.appendChild( searchInput );
	const searchResults = document.createElement( 'ul' );
	searchResults.className = `${ prefix }__search-results`;
	searchResults.hidden = true;
	searchWrap.appendChild( searchResults );
	const hint = document.createElement( 'span' );
	hint.className = `${ prefix }__hint`;
	hint.textContent = opts.hint;
	toolbar.appendChild( searchWrap );
	toolbar.appendChild( hint );
	host.appendChild( toolbar );

	const layout = document.createElement( 'div' );
	layout.className = `${ prefix }__layout`;
	host.appendChild( layout );
	const stage = document.createElement( 'div' );
	stage.className = `${ prefix }__stage is-loading`;
	layout.appendChild( stage );
	const sidebar = document.createElement( 'aside' );
	sidebar.className = `${ prefix }__sidebar`;
	layout.appendChild( sidebar );

	return { toolbar, stage, sidebar, buttons, searchWrap, searchInput, searchResults };
}

/**
 * The search dropdown: case-insensitive substring match, top 10 by
 * count, ArrowDown / ArrowUp / Enter / Escape, hover moves the
 * highlight, mousedown (not click) selects so the input keeps focus.
 * Returns the teardown.
 */
export function wireCanvasSearch< T extends { id: number; count: number; name: string } >(
	chrome: CanvasChrome,
	prefix: string,
	opts: { matches: ( q: string ) => T[]; select: ( item: T ) => void },
): () => void {
	const { searchInput, searchResults, searchWrap } = chrome;
	let currentMatches: T[] = [];
	let selectedIndex = 0;
	const repaintHighlight = (): void => {
		searchResults.querySelectorAll< HTMLButtonElement >( `.${ prefix }__search-result` ).forEach( ( el, i ) => {
			const active = i === selectedIndex;
			el.classList.toggle( 'is-active', active );
			if ( active ) {
				el.scrollIntoView( { block: 'nearest' } );
			}
		} );
	};
	const reset = (): void => {
		searchInput.value = '';
		searchResults.hidden = true;
		searchResults.replaceChildren();
		currentMatches = [];
		selectedIndex = 0;
	};
	const selectMatch = ( item: T ): void => {
		reset();
		opts.select( item );
	};
	const renderResults = (): void => {
		const q = searchInput.value.trim().toLowerCase();
		if ( q.length === 0 ) {
			searchResults.hidden = true;
			searchResults.replaceChildren();
			currentMatches = [];
			selectedIndex = 0;
			return;
		}
		currentMatches = opts.matches( q ).sort( ( a, b ) => b.count - a.count ).slice( 0, 10 );
		selectedIndex = 0;
		searchResults.replaceChildren();
		currentMatches.forEach( ( item, i ) => {
			const li = document.createElement( 'li' );
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = `${ prefix }__search-result`;
			if ( i === 0 ) {
				btn.classList.add( 'is-active' );
			}
			const nameEl = document.createElement( 'span' );
			nameEl.className = `${ prefix }__search-title`;
			nameEl.textContent = item.name || `#${ item.id }`;
			const countEl = document.createElement( 'span' );
			countEl.className = `${ prefix }__search-meta`;
			countEl.textContent = sprintf(
				/* translators: %d: number of posts assigned to a term. */
				_n( '%d post', '%d posts', item.count ),
				item.count,
			);
			btn.appendChild( nameEl );
			btn.appendChild( countEl );
			btn.addEventListener( 'mousedown', ( ev ) => {
				ev.preventDefault();
				selectMatch( item );
			} );
			btn.addEventListener( 'mouseenter', () => {
				selectedIndex = i;
				repaintHighlight();
			} );
			li.appendChild( btn );
			searchResults.appendChild( li );
		} );
		searchResults.hidden = currentMatches.length === 0;
	};
	const onKeydown = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' ) {
			if ( currentMatches.length === 0 ) {
				return;
			}
			ev.preventDefault();
			if ( ev.key === 'ArrowDown' ) {
				selectedIndex = Math.min( selectedIndex + 1, currentMatches.length - 1 );
				repaintHighlight();
			} else if ( ev.key === 'ArrowUp' ) {
				selectedIndex = Math.max( selectedIndex - 1, 0 );
				repaintHighlight();
			} else {
				selectMatch( currentMatches[ selectedIndex ] );
			}
		} else if ( ev.key === 'Escape' ) {
			reset();
		}
	};
	const onBlur = (): void => {
		// Delayed so a mousedown on a result still fires before the
		// dropdown vanishes.
		setTimeout( () => {
			searchResults.hidden = true;
		}, 120 );
	};
	const onDocClick = ( ev: Event ): void => {
		if ( ! searchWrap.contains( ev.target as Node ) ) {
			searchResults.hidden = true;
		}
	};
	searchInput.addEventListener( 'input', renderResults );
	searchInput.addEventListener( 'focus', renderResults );
	searchInput.addEventListener( 'keydown', onKeydown );
	searchInput.addEventListener( 'blur', onBlur );
	document.addEventListener( 'click', onDocClick );
	return () => {
		searchInput.removeEventListener( 'input', renderResults );
		searchInput.removeEventListener( 'focus', renderResults );
		searchInput.removeEventListener( 'keydown', onKeydown );
		searchInput.removeEventListener( 'blur', onBlur );
		document.removeEventListener( 'click', onDocClick );
	};
}
