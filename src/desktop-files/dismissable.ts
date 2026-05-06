/**
 * Tiny helper that wires the standard "outside-click + Escape →
 * dismiss" lifecycle to a floating element. Both the wallpaper
 * context menu and the file-tile context menu need it; the
 * shape stays here so neither has to roll its own.
 *
 * @since 0.9.0
 */

export interface DismissableOptions {
	/**
	 * Callback that closes the floating UI. The helper invokes
	 * this when the user clicks outside or presses Escape.
	 */
	close: () => void;
	/**
	 * Optional list of containers whose clicks should be ignored
	 * (in addition to the host). Useful for flyouts that live
	 * outside the host's subtree but logically belong to it.
	 */
	siblingSelectors?: string[];
	/**
	 * Optional element whose clicks should also be ignored — the
	 * caller exempts e.g. the wallpaper area so a second click on
	 * it can run a toggle handler instead of being eaten by the
	 * dismisser.
	 */
	excludeOutsideTarget?: HTMLElement;
}

/**
 * Attach the dismisser to `host`. Returns a teardown function
 * the caller invokes after `host` is removed from the DOM —
 * unsubscribing from the document listeners.
 */
export function attachDismissable(
	host: HTMLElement,
	options: DismissableOptions,
): () => void {
	const onAway = ( e: MouseEvent ): void => {
		if ( e.target instanceof Node && host.contains( e.target ) ) {
			return;
		}
		if ( e.target instanceof Node ) {
			for ( const sel of options.siblingSelectors ?? [] ) {
				const matches = Array.from(
					document.querySelectorAll( sel ),
				);
				for ( const m of matches ) {
					if ( m.contains( e.target ) ) {
						return;
					}
				}
			}
		}
		if (
			options.excludeOutsideTarget &&
			e.target instanceof Node &&
			options.excludeOutsideTarget.contains( e.target )
		) {
			return;
		}
		options.close();
	};
	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			options.close();
		}
	};
	// `mousedown` so we beat the next click and a synthesized
	// click on a tile inside the host doesn't double-fire.
	document.addEventListener( 'mousedown', onAway, { capture: true } );
	document.addEventListener( 'keydown', onKey );
	return () => {
		document.removeEventListener( 'mousedown', onAway, { capture: true } );
		document.removeEventListener( 'keydown', onKey );
	};
}
