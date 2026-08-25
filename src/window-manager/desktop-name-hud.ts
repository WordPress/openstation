/**
 * OpenStation — the caption naming the Space after a desktop switch.
 *
 * Not shown for a switch made from overview: the top bar there already
 * labels every desktop, and the caption would land on the exit
 * animation. `switchDesktop` calls this from its non-overview branch.
 */

const HOLD_MS = 900;

/** Must match the CSS fade on `--out`. */
const FADE_MS = 260;

const CLS = 'os-desktop-name-hud';

/** One caption, reused: arrow-key switching outruns the fade. */
let hud: HTMLElement | null = null;
let timer: number | null = null;

/** Show `label` over `area` for a beat, then fade it out. */
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
		// The only cue a screen-reader user gets that the switch landed.
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

/** Drop the caption so `destroy()` leaves no timer on detached DOM. */
export function destroyDesktopNameHud(): void {
	if ( timer !== null ) {
		window.clearTimeout( timer );
		timer = null;
	}
	hud?.remove();
	hud = null;
}
