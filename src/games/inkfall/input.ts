/**
 * Inkfall — keyboard capture.
 *
 * A visually hidden `<input type="text">` inside the game body is
 * the focus anchor. Because `document.activeElement` is then a text
 * input, the shell's global key handlers (Backquote window
 * switcher, bare-arrow desktop shortcuts) stand down via their
 * `isTextEntryFocus()` guard — no shell changes, no capture-order
 * races.
 *
 * Letters, Backspace, and Escape are routed to the game and
 * `preventDefault()`ed (the input's value is cleared every
 * keystroke so no text accumulates). Modifier combos (⌘K & co.)
 * pass through untouched.
 */

export interface InputHandlers {
	onLetter: ( letter: string ) => void;
	onBackspace: () => void;
	onEscape: () => void;
}

export interface GameInput {
	/** Give the hidden input focus (call on open / focus / click). */
	focus: () => void;
	/** Remove listeners + the hidden input. */
	dispose: () => void;
}

export function createGameInput(
	host: HTMLElement,
	handlers: InputHandlers,
): GameInput {
	const input = document.createElement( 'input' );
	input.type = 'text';
	input.autocomplete = 'off';
	input.autocapitalize = 'off';
	input.spellcheck = false;
	input.setAttribute( 'aria-hidden', 'true' );
	input.tabIndex = -1;
	input.className = 'inkfall__key-capture';
	host.appendChild( input );

	const onKeyDown = ( e: KeyboardEvent ): void => {
		// Modifier combos belong to the shell / browser.
		if ( e.metaKey || e.ctrlKey || e.altKey ) {
			return;
		}
		if ( 'Backspace' === e.key ) {
			e.preventDefault();
			handlers.onBackspace();
			return;
		}
		if ( 'Escape' === e.key ) {
			e.preventDefault();
			handlers.onEscape();
			return;
		}
		if ( e.key.length === 1 && /[a-zA-Z]/.test( e.key ) ) {
			e.preventDefault();
			handlers.onLetter( e.key.toLowerCase() );
		}
	};
	const onInput = (): void => {
		// Belt-and-suspenders: IME / paste paths that bypass keydown
		// must not accumulate text in the hidden field.
		input.value = '';
	};
	input.addEventListener( 'keydown', onKeyDown );
	input.addEventListener( 'input', onInput );

	// Clicking anywhere in the game refocuses the capture field.
	const onPointerDown = (): void => {
		// Defer — let the click land first, then reclaim focus.
		window.setTimeout( () => input.focus(), 0 );
	};
	host.addEventListener( 'pointerdown', onPointerDown );

	return {
		focus: () => input.focus(),
		dispose: () => {
			input.removeEventListener( 'keydown', onKeyDown );
			input.removeEventListener( 'input', onInput );
			host.removeEventListener( 'pointerdown', onPointerDown );
			input.remove();
		},
	};
}
