import { __, _n, sprintf } from '@openstation/app';
import { directoryStyles } from './directory.styles';

export const CANVAS_PREFIX = 'os-term-canvas';

export interface ChromeButton {

	variant?: string;
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

export function canvasButton( variant: string, label: string ): HTMLButtonElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.className = `${ CANVAS_PREFIX }__btn${ variant ? ` ${ CANVAS_PREFIX }__btn--${ variant }` : '' }`;
	btn.textContent = label;
	return btn;
}

export function buildCanvasChrome(
	host: HTMLElement,
	modifier: string,
	opts: { buttons: ChromeButton[]; searchPlaceholder: string; searchAria: string; hint: string },
): CanvasChrome {
	host.replaceChildren();
	host.classList.add( CANVAS_PREFIX, modifier );
	const style = document.createElement( 'style' );
	style.textContent = directoryStyles.cssText;
	host.appendChild( style );

	const intro = document.createElement( 'header' );
	intro.className = 'os-term-canvas__intro';
	const heading = document.createElement( 'h2' );
	heading.textContent = modifier === 'os-mindmap' ? __( 'Give your ideas a home.' ) : __( 'Find the threads.' );
	const description = document.createElement( 'p' );
	description.textContent = modifier === 'os-mindmap' ? __( 'Build branches for your stories. Choose a category to explore its posts.' ) : __( 'See what connects your stories. Choose a tag to follow the conversation.' );
	intro.append( heading, description );
	host.appendChild( intro );

	const toolbar = document.createElement( 'div' );
	toolbar.className = `${ CANVAS_PREFIX }__toolbar`;
	const buttons = opts.buttons.map( ( b ) => {
		const btn = canvasButton( b.variant ?? '', '' );
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ b.icon }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		btn.replaceChildren( icon, document.createTextNode( b.label ) );
		if ( b.title ) {
			btn.title = b.title;
		}
		toolbar.appendChild( btn );
		return btn;
	} );
	const searchWrap = document.createElement( 'div' );
	searchWrap.className = `${ CANVAS_PREFIX }__search`;
	const searchInput = document.createElement( 'input' );
	searchInput.type = 'search';
	searchInput.className = `${ CANVAS_PREFIX }__search-input`;
	searchInput.placeholder = opts.searchPlaceholder;
	searchInput.setAttribute( 'aria-label', opts.searchAria );
	searchWrap.appendChild( searchInput );
	const searchResults = document.createElement( 'ul' );
	searchResults.className = `${ CANVAS_PREFIX }__search-results`;
	searchResults.hidden = true;
	searchWrap.appendChild( searchResults );
	const hint = document.createElement( 'span' );
	hint.className = `${ CANVAS_PREFIX }__hint`;
	hint.textContent = opts.hint;
	toolbar.appendChild( searchWrap );
	toolbar.appendChild( hint );
	host.appendChild( toolbar );

	const layout = document.createElement( 'div' );
	layout.className = `${ CANVAS_PREFIX }__layout`;
	host.appendChild( layout );
	const stage = document.createElement( 'div' );
	stage.className = `${ CANVAS_PREFIX }__stage is-loading`;
	layout.appendChild( stage );
	const sidebar = document.createElement( 'aside' );
	sidebar.className = `${ CANVAS_PREFIX }__sidebar`;
	layout.appendChild( sidebar );

	return { toolbar, stage, sidebar, buttons, searchWrap, searchInput, searchResults };
}

export function wireCanvasSearch< T extends { id: number; count: number; name: string } >(
	chrome: CanvasChrome,
	opts: { matches: ( q: string ) => T[]; select: ( item: T ) => void },
): () => void {
	const { searchInput, searchResults, searchWrap } = chrome;
	let currentMatches: T[] = [];
	let selectedIndex = 0;
	const repaintHighlight = (): void => {
		searchResults.querySelectorAll< HTMLButtonElement >( `.${ CANVAS_PREFIX }__search-result` ).forEach( ( el, i ) => {
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
			btn.className = `${ CANVAS_PREFIX }__search-result`;
			if ( i === 0 ) {
				btn.classList.add( 'is-active' );
			}
			const nameEl = document.createElement( 'span' );
			nameEl.className = `${ CANVAS_PREFIX }__search-title`;
			nameEl.textContent = item.name || `#${ item.id }`;
			const countEl = document.createElement( 'span' );
			countEl.className = `${ CANVAS_PREFIX }__search-meta`;
			countEl.textContent = sprintf(

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
