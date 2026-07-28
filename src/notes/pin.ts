/**
 * Desktop Mode — Pushpin element factory.
 *
 * One seam for every surface that renders the pushpin (the pinned
 * note, the Note Pad widget's ghost-pin empty state, the drag ghost)
 * so the asset URL, sizing, and the needle-tip anchor stay in one
 * place.
 *
 * Asset: `assets/images/pushpin.svg` — "Pushpin 2" by randoogle
 * (openclipart.org/detail/33601, public domain), cleaned of its baked
 * cast shadow so the CSS-driven dynamic shadow can animate during
 * pull-out / insertion. Shipped as `<img>` (never inlined): the SVG
 * uses bare gradient/filter ids that would collide document-wide when
 * repeated once per note.
 */

/**
 * Where the needle tip sits inside the SVG viewBox, as fractions.
 * Measured from the source geometry — see the comment block inside
 * `assets/images/pushpin.svg`. The tip is the rotation anchor for
 * every pin animation and the "grab point" the drag ghost rides on.
 */
export const PIN_TIP_X = 0.57;
export const PIN_TIP_Y = 0.525;

/**
 * Rendered pin size in CSS px (viewBox is 131.64 × 123.82). Keep in
 * sync with the pixel constants in `assets/css/notes.css`
 * (`.desktop-mode-pinned-note__pin` / `__pin-img`).
 */
export const PIN_WIDTH = 56;
export const PIN_HEIGHT = 52;

/** Absolute URL of the pushpin asset for a given plugin base URL. */
export function pushpinUrl( pluginUrl: string ): string {
	return `${ pluginUrl.replace( /\/$/, '' ) }/assets/images/pushpin.svg`;
}

/**
 * Build the pin `<img>`. Purely decorative — interactivity (the drag
 * handle button) is the caller's wrapper.
 */
export function buildPinImage( pluginUrl: string ): HTMLImageElement {
	const img = document.createElement( 'img' );
	img.src = pushpinUrl( pluginUrl );
	img.alt = '';
	img.width = PIN_WIDTH;
	img.height = PIN_HEIGHT;
	img.draggable = false;
	img.className = 'desktop-mode-pinned-note__pin-img';
	return img;
}
