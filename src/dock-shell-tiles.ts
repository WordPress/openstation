/**
 * The shell's own dock tiles: their ids, their art, and the order they
 * sit in.
 *
 * The tiles that answer for OpenStation itself rather than for the
 * site: Site assistant, Mio, Overview, System and Exit OpenStation,
 * clustered at the tail of the rail. Everything here is data;
 * `desktop.ts` does the registering.
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
 * single rail. A tile that wants a glyph the set already has borrows
 * its SHAPE and redraws it here at this weight, as Overview does with
 * `widgets`. If the tiles move to the set they move together, and
 * `osIconDataUri()` exists for exactly that.
 *
 * The Site assistant tile is the exception: it wears the set's
 * `copilot` paths as they are. The sparkle is filled, so there is no
 * stroke weight to match, and it is the brand's mark for the
 * assistant, so a redrawn copy could only drift from it.
 */

/** Tile ids. Stable strings: they key visibility overrides in Preferences. */
export const ASSISTANT_TILE_ID = 'os-site-assistant';
export const OVERVIEW_TILE_ID = 'os-overview';
export const SYSTEM_TILE_ID = 'os-system';

/**
 * Sort keys for the trailing cluster. Spaced by ten so a plugin can
 * slot between two of them without a renumbering.
 */
export const SYSTEM_TILE_ORDER = {
	assistant: 5,
	mio: 10,
	overview: 20,
	system: 30,
	exit: 35,
} as const;

/**
 * Overview: the brand's asymmetric bento — one large pane, three
 * smaller ones around it.
 *
 * The shape is `widgets` from `src/ui/icons`, transposed onto this
 * family's 64 grid and drawn at its stroke weight rather than taken
 * through `osIconDataUri()`, so the rail keeps one weight across all
 * four tiles. Panes of unequal size are what separates it from the
 * three grids of equal squares it used to be confused with:
 * `dashicons-grid-view` on the admin bar's Arrange menu,
 * `dashicons-screenoptions` in every window's overflow menu, and the
 * set's own `apps`.
 */
export const OS_OVERVIEW_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round">' +
	'<rect x="6" y="6" width="27" height="27" rx="5"/>' +
	'<rect x="43" y="6" width="15" height="15" rx="5"/>' +
	'<rect x="43" y="31" width="15" height="27" rx="5"/>' +
	'<rect x="6" y="43" width="27" height="15" rx="5"/>' +
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

/**
 * Site assistant: the brand's copilot sparkle, the same glyph the
 * assistant's own input shows in Ask AI mode.
 */
export const OS_ASSISTANT_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
	'<path d="M10 2.5Q10.9 8.5 17.5 10Q10.9 11.5 10 17.5Q9.1 11.5 2.5 10Q9.1 8.5 10 2.5Z"/>' +
	'<path d="M17.9 14Q18.35 17.1 21.5 17.6Q18.35 18.1 17.9 21.2Q17.45 18.1 14.3 17.6Q17.45 17.1 17.9 14Z"/>' +
	'</svg>';

export const OS_ASSISTANT_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_ASSISTANT_SVG,
) }`;
