/**
 * mio-js — "Make it yours" panel stand-in.
 *
 * The shell gives Mio a right-click menu that opens a live-preview
 * style panel: sliders for hue, glow, silhouette, the lot. It is built
 * out of `<os-*>` web components and the shell-overlay loader, and it
 * exists to let a user build *their* Mio.
 *
 * This library ships the **official** Mio and nothing else, so the
 * panel has no job here — and pulling it in would drag the component
 * kit, the overlay loader and the i18n layer into a bundle whose whole
 * point is being one file you can drop in a blog.
 *
 * The build aliases `./style-panel` to this module (see
 * `vite.config.js`). Right-clicking Mio therefore does nothing at all
 * — `mio.ts` still swallows the event on the drag handle, which keeps
 * a right-click from turning into a stray page context menu over a
 * mascot that has no menu to offer.
 */

/** No panel to open. */
export function openMioMenu( _pos: { x: number; y: number } ): void {
	/* The official Mio has nothing to configure. */
}

/** No panel to close. */
export function closeMioMenu(): void {
	/* Nothing was ever opened. */
}

/** No panel to close. */
export function closeMioStylePanel(): void {
	/* Nothing was ever opened. */
}
