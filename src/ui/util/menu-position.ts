const MARGIN = 8;

export function placeAfterRender(
	menu: HTMLElement,
	place: ( rect: DOMRect ) => void,
): void {
	menu.style.visibility = 'hidden';
	const run = (): void => {
		if ( ! menu.isConnected ) {
			return;
		}
		place( menu.getBoundingClientRect() );
		menu.style.visibility = '';
	};
	if ( typeof requestAnimationFrame === 'function' ) {
		requestAnimationFrame( run );
	} else {
		run();
	}
}

export function clampToViewport( menu: HTMLElement ): void {
	placeAfterRender( menu, ( rect ) => {
		if ( rect.right > window.innerWidth ) {
			menu.style.left = `${ Math.max(
				0,
				window.innerWidth - rect.width - MARGIN,
			) }px`;
		}
		if ( rect.bottom > window.innerHeight ) {
			menu.style.top = `${ Math.max(
				0,
				window.innerHeight - rect.height - MARGIN,
			) }px`;
		}
	} );
}

export function positionFlyout( fly: HTMLElement, anchor: HTMLElement ): void {
	const ar = anchor.getBoundingClientRect();

	fly.style.position = 'fixed';
	fly.style.left = `${ ar.right }px`;
	fly.style.top = `${ ar.top }px`;
	placeAfterRender( fly, ( rect ) => {
		if ( rect.right > window.innerWidth ) {
			fly.style.left = `${ Math.max( 0, ar.left - rect.width ) }px`;
		}
		if ( rect.bottom > window.innerHeight ) {
			fly.style.top = `${ Math.max(
				0,
				window.innerHeight - rect.height - MARGIN,
			) }px`;
		}
	} );
}
