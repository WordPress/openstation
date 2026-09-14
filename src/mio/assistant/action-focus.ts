/** Restore focus after native busy/disabled state, unless the user moved it. */
export function mioActionFocus( button: HTMLElement ): { update: ( pending: boolean ) => void; dispose: () => void } {
	let watching: AbortController | null = null;
	let restore = false;
	const stop = (): void => {
		watching?.abort(); watching = null;
	};
	return {
		update: ( pending ) => {
			if ( pending && ! watching ) {
				watching = new AbortController();
				restore = button.ownerDocument.activeElement === button;
				const moved = ( event: Event ): void => {
					if ( ! event.composedPath().includes( button ) ) {
						restore = false;
					}
				};
				const options = { capture: true, signal: watching.signal };
				button.ownerDocument.addEventListener( 'focusin', moved, options );
				button.ownerDocument.addEventListener( 'pointerdown', moved, options );
				button.ownerDocument.addEventListener( 'keydown', ( event ) => {
					if ( event.key === 'Tab' ) {
						restore = false;
					}
				}, options );
			} else if ( ! pending && watching ) {
				const shouldRestore = restore;
				stop();
				queueMicrotask( () => queueMicrotask( () => {
					const focused = button.ownerDocument.activeElement;
					if ( shouldRestore && button.isConnected && ! button.hasAttribute( 'disabled' ) &&
						( focused === button.ownerDocument.body || focused === button ) ) {
						button.shadowRoot?.querySelector<HTMLButtonElement>( 'button' )?.focus( { preventScroll: true } );
					}
				} ) );
			}
		},
		dispose: stop,
	};
}
