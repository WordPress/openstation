export interface InputHandlers {
	onLetter: ( letter: string ) => void;
	onBackspace: () => void;
	onEscape: () => void;
}

export interface GameInput {

	focus: () => void;

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
		input.value = '';
	};
	input.addEventListener( 'keydown', onKeyDown );
	input.addEventListener( 'input', onInput );

	const onPointerDown = (): void => {
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
