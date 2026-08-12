/**
 * Is the hover-submenu layout currently painted?
 *
 * A deliberate leaf module with zero imports. Two very different
 * consumers ask this question — the constellation itself, and
 * `dock-peek`, which has to stand down for menu tiles while the
 * constellation owns the hover gesture — and routing the answer
 * through either of them would put an import edge between two
 * modules that otherwise know nothing about each other.
 *
 * The shell root carries the active layout in `data-os-layout`
 * (written by the layout dispatcher on every `setLayout`), so the
 * DOM is the source of truth here rather than a cached copy that
 * could drift out of sync with a live layout switch.
 */

/** The layout id whose dock fans submenus out on hover. */
export const CONSTELLATION_LAYOUT = 'openstation';

export function isConstellationLayoutActive(): boolean {
	const shell = document.querySelector( '.os-shell' );
	return (
		shell?.getAttribute( 'data-os-layout' ) === CONSTELLATION_LAYOUT
	);
}
