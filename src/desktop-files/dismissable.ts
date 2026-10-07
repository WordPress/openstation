export interface DismissableOptions {

	close: () => void;

	siblingSelectors?: string[];

	excludeOutsideTarget?: HTMLElement;
}

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

	document.addEventListener( 'mousedown', onAway, { capture: true } );
	document.addEventListener( 'keydown', onKey );
	return () => {
		document.removeEventListener( 'mousedown', onAway, { capture: true } );
		document.removeEventListener( 'keydown', onKey );
	};
}
