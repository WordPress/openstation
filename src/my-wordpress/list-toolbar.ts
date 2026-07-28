/**
 * My WordPress — list-view toolbar.
 *
 * Thin chrome that sits between the breadcrumb header and the tile
 * grid in every entity list view (Posts, Pages, Users, Media, plus
 * any plugin-registered kind that mounts the helper). Owns the
 * search input + a 300ms debounce + native-X clearing.
 *
 * Mirrors the visual shape of the Content Graph toolbar's search
 * input so the two surfaces read as the same control. Server-side
 * search via `?search=<q>` on each WP REST collection — see
 * `fetchEntityList`, `fetchUserList`, `fetchMediaPage` for the
 * pass-through.
 *
 * @public
 */

import { __ } from '../i18n';

const DEBOUNCE_MS = 300;

export interface ListToolbarOptions {
	/**
	 * Fires when the debounced search query changes. Empty string
	 * means "clear the search". Callers reset pagination state and
	 * refetch page 1 with the new query.
	 */
	onSearchChange: ( query: string ) => void;
	/** Placeholder shown when the input is empty. */
	placeholder?: string;
	/** ARIA label for the input. */
	ariaLabel?: string;
	/** Initial query value. Empty by default. */
	initialValue?: string;
}

export interface ListToolbarHandle {
	/** Outer DOM element — caller mounts this into the window body. */
	host: HTMLElement;
	/** Current debounced query. */
	getQuery: () => string;
	/** Tear down the input, debounce timer, and event listeners. */
	destroy: () => void;
}

/**
 * Build a list-view toolbar with a search input. Single piece of
 * chrome today; the helper exists so future controls (filter chips,
 * sort, group-by) can be plumbed in one place rather than added to
 * every list renderer.
 *
 * @public
 */
export function renderListToolbar(
	options: ListToolbarOptions,
): ListToolbarHandle {
	const host = document.createElement( 'div' );
	host.className = 'desktop-mode-my-wordpress__list-toolbar';

	const search = document.createElement( 'div' );
	search.className = 'desktop-mode-my-wordpress__list-toolbar-search';

	const input = document.createElement( 'input' );
	input.type = 'search';
	input.className = 'desktop-mode-my-wordpress__list-toolbar-search-input';
	input.placeholder =
		options.placeholder ?? __( 'Search…', 'desktop-mode' );
	input.setAttribute(
		'aria-label',
		options.ariaLabel ?? options.placeholder ?? __( 'Search', 'desktop-mode' ),
	);
	input.autocomplete = 'off';
	input.spellcheck = false;
	if ( options.initialValue ) {
		input.value = options.initialValue;
	}
	search.appendChild( input );
	host.appendChild( search );

	let debounceId: ReturnType< typeof setTimeout > | null = null;
	let lastEmitted = options.initialValue ?? '';

	const emit = ( raw: string ) => {
		const normalized = raw.trim();
		if ( normalized === lastEmitted ) {
			return;
		}
		lastEmitted = normalized;
		options.onSearchChange( normalized );
	};

	const onInput = () => {
		if ( debounceId !== null ) {
			clearTimeout( debounceId );
		}
		debounceId = setTimeout( () => {
			debounceId = null;
			emit( input.value );
		}, DEBOUNCE_MS );
	};
	input.addEventListener( 'input', onInput );

	// Native `type="search"` ships a clear-X in WebKit/Chrome. Clicking
	// it fires `input` with an empty value AND a `search` event — pin
	// to the latter as a belt-and-braces so the debounce doesn't add
	// 300ms of lag to an explicit clear.
	const onSearchEvent = () => {
		if ( input.value === '' ) {
			if ( debounceId !== null ) {
				clearTimeout( debounceId );
				debounceId = null;
			}
			emit( '' );
		}
	};
	input.addEventListener( 'search', onSearchEvent );

	// Enter commits immediately too — saves the debounce wait for
	// users who type then press Enter.
	const onKeydown = ( ev: KeyboardEvent ) => {
		if ( ev.key === 'Enter' ) {
			ev.preventDefault();
			if ( debounceId !== null ) {
				clearTimeout( debounceId );
				debounceId = null;
			}
			emit( input.value );
		}
	};
	input.addEventListener( 'keydown', onKeydown );

	return {
		host,
		getQuery: () => lastEmitted,
		destroy: () => {
			if ( debounceId !== null ) {
				clearTimeout( debounceId );
				debounceId = null;
			}
			input.removeEventListener( 'input', onInput );
			input.removeEventListener( 'search', onSearchEvent );
			input.removeEventListener( 'keydown', onKeydown );
		},
	};
}
