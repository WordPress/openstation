const HOLD_MS = 900;

const FADE_MS = 260;

const CLS = 'os-desktop-name-hud';

let hud: HTMLElement | null = null;
let timer: number | null = null;

export function showDesktopNameHud( area: HTMLElement, label: string ): void {
	if ( ! label.trim() ) {
		return;
	}
	if ( timer !== null ) {
		window.clearTimeout( timer );
	}
	if ( ! hud ) {
		hud = document.createElement( 'div' );
		hud.className = CLS;

		hud.setAttribute( 'role', 'status' );
	}
	hud.textContent = label;
	hud.classList.remove( `${ CLS }--out` );
	area.appendChild( hud );

	timer = window.setTimeout( () => {
		hud?.classList.add( `${ CLS }--out` );
		timer = window.setTimeout( () => {
			hud?.remove();
			timer = null;
		}, FADE_MS ) as unknown as number;
	}, HOLD_MS ) as unknown as number;
}

export function destroyDesktopNameHud(): void {
	if ( timer !== null ) {
		window.clearTimeout( timer );
		timer = null;
	}
	hud?.remove();
	hud = null;
}
