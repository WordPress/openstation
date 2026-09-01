/**
 * The shell's own dock tiles: their ids, their art, and the order they
 * sit in.
 *
 * The tiles that answer for OpenStation itself rather than for the
 * site: Mio, Overview and System, clustered at the
 * tail of the rail. Everything here is data; `desktop.ts` does the
 * registering.
 *
 * The orders are the point of the module. Registration order cannot
 * express the intended rail: native-window tiles (Trash, and every
 * plugin's) arrive whenever their lazy script resolves, so a tile
 * registered last in `desktop.ts` can still be overtaken. Anything
 * left at the default `0` sorts ahead of this cluster, which is the
 * intent — the site's apps first, the shell's own affordances last.
 */

/*
 * A note on why none of the art below comes from `src/ui/icons`.
 *
 * Dock tiles are a family of their own: a 64x64 grid, heavier strokes
 * than the 24-grid set, and every one of them shipped as a `data:` URI
 * because the dock, desktop-icon and window APIs take an `icon:`
 * string rather than markup. They are also masked to a single colour
 * by the rail, so they are drawn for that treatment.
 *
 * Two of the four have no member in the thirty at all (the gear is
 * deliberately NOT Core's `settings`, because the System tile beside
 * it already means settings, and a keyboard is in neither set), so
 * converting the rest would leave one family drawn two ways inside a
 * single rail. If the tiles move to the set they move together, and
 * `osIconDataUri()` exists for exactly that.
 */

/** Tile ids. Stable strings: they key visibility overrides in Preferences. */
export const OVERVIEW_TILE_ID = 'os-overview';
export const SYSTEM_TILE_ID = 'os-system';
/** The site assistant's tile, on rails that have no tray to hold it. */
export const ASSISTANT_TILE_ID = 'os-assistant';

/**
 * Sort keys for the trailing cluster. Spaced by ten so a plugin can
 * slot between two of them without a renumbering.
 */
export const SYSTEM_TILE_ORDER = {
	mio: 10,
	overview: 20,
	system: 30,
	exit: 35,
} as const;

/**
 * Overview: four panes pulling apart from a centre.
 *
 * Drawn rather than borrowed because the two Dashicons that come
 * closest already mean something else on this rail —
 * `dashicons-grid-view` is the admin-bar Arrange menu this replaces,
 * and `dashicons-screenoptions` is Screen Options in every window's
 * overflow menu. Four rounded rects with a gap through the middle is
 * the one shape that reads as "every window at once" at 20px.
 */
export const OS_OVERVIEW_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor">' +
	'<rect x="6" y="6" width="23" height="23" rx="4"/>' +
	'<rect x="35" y="6" width="23" height="23" rx="4"/>' +
	'<rect x="6" y="35" width="23" height="23" rx="4"/>' +
	'<rect x="35" y="35" width="23" height="23" rx="4"/>' +
	'</svg>';

export const OS_OVERVIEW_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_OVERVIEW_SVG,
) }`;

/**
 * System: a sliders glyph — two tracks, two handles.
 *
 * Not the gear. The gear is OpenStation Preferences, which is now one
 * ROW inside this tile's menu; wearing it on the parent would make the
 * tile look like a duplicate of its own first entry.
 */
export const OS_SYSTEM_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">' +
	'<path d="M10 22h44M10 42h44"/>' +
	'<circle cx="24" cy="22" r="7" fill="currentColor" stroke="none"/>' +
	'<circle cx="42" cy="42" r="7" fill="currentColor" stroke="none"/>' +
	'</svg>';

export const OS_SYSTEM_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_SYSTEM_SVG,
) }`;
