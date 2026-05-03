/**
 * Routines — `{{placeholder}}` autocomplete.
 *
 * Attaches a popover to a text input that suggests:
 *
 *   1. Trigger payload paths (`payload.comment.content`)
 *   2. Upstream step result variables (`vars.<step.id>.…`)
 *   3. Site / user globals (`site.url`, `user.id`)
 *
 * Triggered when the caret is inside an open `{{ }}`. Uses arrow
 * keys + Tab/Enter to select. Detached on input blur or Escape.
 *
 * Pure — no React, no third-party combobox lib. The popover is a
 * `<ul>` rendered into the same parent so it positions naturally
 * below the input via CSS.
 *
 * @since 0.22.0
 */

import { el } from './dom';

export interface Suggestion {
	path: string;
	type: string;
	description: string;
	source: 'payload' | 'vars' | 'site' | 'user' | 'custom';
}

interface AutocompleteState {
	popover: HTMLUListElement | null;
	highlight: number;
	suggestions: Suggestion[];
}

/**
 * Wire `{{var}}` autocomplete to an input or textarea.
 *
 * @param input         Input or textarea element.
 * @param suggestionsOf Returns the complete suggestion catalogue.
 *                      Re-invoked on every open so the canvas can
 *                      refresh upstream-step vars as the user edits.
 */
export function attachAutocomplete(
	input: HTMLInputElement | HTMLTextAreaElement,
	suggestionsOf: () => Suggestion[],
): void {
	const state: AutocompleteState = {
		popover: null,
		highlight: 0,
		suggestions: [],
	};

	const close = (): void => {
		state.popover?.remove();
		state.popover = null;
		state.highlight = 0;
		state.suggestions = [];
	};

	const open = (): void => {
		const ctx = activeContext( input );
		if ( ! ctx ) {
			close();
			return;
		}
		const all = suggestionsOf();
		const q = ctx.query.toLowerCase();
		const filtered = all.filter( ( s ) => {
			if ( ! q ) {
				return true;
			}
			return (
				s.path.toLowerCase().includes( q ) ||
				s.description.toLowerCase().includes( q )
			);
		} );
		state.suggestions = filtered.slice( 0, 12 );
		state.highlight = 0;
		render( input, state, ( s ) => insert( input, ctx, s, close ) );
	};

	input.addEventListener( 'input', open );
	input.addEventListener( 'click', open );
	input.addEventListener( 'keyup', ( ev ) => {
		const k = ( ev as KeyboardEvent ).key;
		// Reposition / refilter on caret move.
		if ( [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ].includes( k ) ) {
			open();
		}
	} );
	input.addEventListener( 'keydown', ( e ) => {
		const ev = e as KeyboardEvent;
		if ( ! state.popover || state.suggestions.length === 0 ) {
			return;
		}
		if ( ev.key === 'ArrowDown' ) {
			ev.preventDefault();
			state.highlight =
				( state.highlight + 1 ) % state.suggestions.length;
			repaint( state );
		} else if ( ev.key === 'ArrowUp' ) {
			ev.preventDefault();
			state.highlight =
				( state.highlight - 1 + state.suggestions.length ) %
				state.suggestions.length;
			repaint( state );
		} else if ( ev.key === 'Enter' || ev.key === 'Tab' ) {
			ev.preventDefault();
			const ctx = activeContext( input );
			const pick = state.suggestions[ state.highlight ];
			if ( ctx && pick ) {
				insert( input, ctx, pick, close );
			}
		} else if ( ev.key === 'Escape' ) {
			ev.preventDefault();
			close();
		}
	} );
	input.addEventListener( 'blur', () => {
		// Slight delay so a click on a suggestion lands first.
		window.setTimeout( close, 120 );
	} );
}

/** Caret context: are we inside a `{{ }}` token? */
interface Context {
	tokenStart: number;
	tokenEnd: number;
	query: string;
}

function activeContext(
	input: HTMLInputElement | HTMLTextAreaElement,
): Context | null {
	const value = input.value;
	const caret = input.selectionStart ?? value.length;
	// Find the most recent unclosed `{{` before the caret.
	const before = value.slice( 0, caret );
	const lastOpen = before.lastIndexOf( '{{' );
	if ( lastOpen < 0 ) {
		return null;
	}
	const lastClose = before.lastIndexOf( '}}' );
	if ( lastClose > lastOpen ) {
		return null; // closed before caret — not inside.
	}
	// The query is everything between `{{` and the caret, trimmed of
	// leading whitespace.
	const query = before.slice( lastOpen + 2 ).replace( /^\s+/, '' );
	// End: scan forward to a `}}` if any (caret may be mid-token).
	const after = value.slice( caret );
	const closeIdx = after.indexOf( '}}' );
	const tokenEnd = closeIdx >= 0 ? caret + closeIdx + 2 : caret;
	return { tokenStart: lastOpen, tokenEnd, query };
}

function render(
	input: HTMLInputElement | HTMLTextAreaElement,
	state: AutocompleteState,
	pickHandler: ( s: Suggestion ) => void,
): void {
	if ( state.suggestions.length === 0 ) {
		state.popover?.remove();
		state.popover = null;
		return;
	}
	if ( ! state.popover ) {
		state.popover = el( 'ul', { class: 'wpdm-routines__ac' } );
		input.parentElement?.append( state.popover );
	}
	state.popover.replaceChildren();
	state.suggestions.forEach( ( s, i ) => {
		const li = el( 'li', {
			class:
				'wpdm-routines__ac-item' +
				( i === state.highlight ? ' is-active' : '' ),
		} );
		const path = el( 'span', { class: 'wpdm-routines__ac-path' } );
		path.textContent = s.path;
		const type = el( 'span', { class: 'wpdm-routines__ac-type' } );
		type.textContent = s.type;
		li.append( path, type );
		if ( s.description ) {
			const desc = el( 'span', { class: 'wpdm-routines__ac-desc' } );
			desc.textContent = s.description;
			li.append( desc );
		}
		// `mousedown` (not `click`) — the input's blur handler runs
		// on click, and clicks land after blur, so a `click` listener
		// here would never fire. `mousedown` fires before blur.
		li.addEventListener( 'mousedown', ( ev ) => {
			ev.preventDefault();
			pickHandler( s );
		} );
		state.popover!.append( li );
	} );
}

function repaint( state: AutocompleteState ): void {
	if ( ! state.popover ) {
		return;
	}
	const items = state.popover.children;
	for ( let i = 0; i < items.length; i++ ) {
		items[ i ].classList.toggle( 'is-active', i === state.highlight );
	}
}

function insert(
	input: HTMLInputElement | HTMLTextAreaElement,
	ctx: Context,
	pick: Suggestion,
	close: () => void,
): void {
	const before = input.value.slice( 0, ctx.tokenStart );
	const after = input.value.slice( ctx.tokenEnd );
	const inserted = `{{${ pick.path }}}`;
	input.value = before + inserted + after;
	const caret = before.length + inserted.length;
	input.setSelectionRange( caret, caret );
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	close();
	input.focus();
}
