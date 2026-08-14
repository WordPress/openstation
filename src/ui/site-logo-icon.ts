/**
 * The glyph the site assistant answers to.
 *
 * `siteLogo` from `@wordpress/icons`, transcribed rather than imported
 * so it costs a string instead of a package. It heads the assistant's
 * palette and it is the assistant's dock tile.
 *
 * It lives here, in a leaf both bundles can reach, rather than in
 * `ai-assistant/impl.ts` where it was: the assistant ships as a lazy
 * bundle that a user who never opens the palette never downloads, and
 * the dock tile has to paint on every boot. Importing the glyph from
 * the assistant's entry would have dragged the whole feature into the
 * shell bundle as a side effect — the trap AGENTS.md names under
 * cross-bundle state.
 *
 * Deliberately NOT the sparkle or the magnifier. Those two are the
 * palette's MODE indicator, swapped on the input as the user moves
 * between Ask AI and Commands; a tile wearing one of them would change
 * meaning with the site's provider configuration. This is the
 * assistant's identity, and it holds still.
 */

/** The mark as standalone SVG source, in Core's 24×24 icon viewBox. */
export const OS_SITE_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
	'<path d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8Zm0 1.5c3.4 0 6.2 2.7 6.5 6l-1.2-.6-.8-.4c-.1 0-.2 0-.3-.1H16c-.1-.2-.4-.2-.7 0l-2.9 2.1L9 11.3h-.7L5.5 13v-1.1c0-3.6 2.9-6.5 6.5-6.5Zm0 13c-2.7 0-5-1.7-6-4l2.8-1.7 3.5 1.2h.4s.2 0 .4-.2l2.9-2.1.4.2c.6.3 1.4.7 2.1 1.1-.5 3.1-3.2 5.4-6.4 5.4Z"/>' +
	'</svg>';

/**
 * The same art as a base64 data URI, for any `icon:` field in the
 * dock / desktop-icon / window APIs.
 */
export const OS_SITE_LOGO_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_SITE_LOGO_SVG,
) }`;
