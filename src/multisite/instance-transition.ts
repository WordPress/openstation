export type HopDirection = 'next' | 'prev';

export const HOP_OUT_MS = 220;

export const REVEAL_MS = 360;

const REVEAL_FALLBACK_MS = 4000;

const DIRECTION_KEY = 'openstation-hop-direction';

const ARRIVING = 'os-shell--arriving';
const REVEALING = 'os-shell--revealing';

function shellRoot(): HTMLElement | null {
	return document.getElementById( 'os-shell' );
}

function reducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

export function leaveInstance( direction: HopDirection ): Promise< void > {
	try {
		window.sessionStorage.setItem( DIRECTION_KEY, direction );
	} catch {

	}
	const root = shellRoot();
	if ( ! root || reducedMotion() ) {
		return Promise.resolve();
	}
	root.classList.add( `os-shell--hop-out-${ direction }` );
	return new Promise( ( resolve ) => {
		window.setTimeout( resolve, HOP_OUT_MS );
	} );
}

function takeArrivalDirection(): HopDirection | null {
	try {
		const value = window.sessionStorage.getItem( DIRECTION_KEY );
		window.sessionStorage.removeItem( DIRECTION_KEY );
		return value === 'next' || value === 'prev' ? value : null;
	} catch {
		return null;
	}
}

export function stampArrival( fallback: HopDirection | null = null ): void {
	const root = shellRoot();
	if ( ! root || ! root.classList.contains( ARRIVING ) ) {
		return;
	}
	const direction = takeArrivalDirection() ?? fallback;
	if ( direction ) {
		root.classList.add( `os-shell--arriving-${ direction }` );
	}
	window.setTimeout( revealInstance, REVEAL_FALLBACK_MS );
}

export function revealInstance(): void {
	const root = shellRoot();
	if ( ! root || ! root.classList.contains( ARRIVING ) ) {
		return;
	}
	root.classList.remove(
		ARRIVING,
		'os-shell--arriving-next',
		'os-shell--arriving-prev',
	);
	if ( reducedMotion() ) {
		return;
	}

	root.classList.add( REVEALING );
	window.setTimeout( () => root.classList.remove( REVEALING ), REVEAL_MS );
}
