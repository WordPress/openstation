/**
 * The OpenStation logomark, as art the shell can paint.
 *
 * One transcription of the mark, in one place, for every surface that
 * needs to *be* OpenStation rather than merely sit inside it — the
 * OpenStation Settings tile today, the rebrand announcement beside it.
 * The path is copied stop-for-stop from the brand's `logomark.svg`
 * (the refined upright circle-with-a-blob-cut), so retracing it means
 * editing this constant and nothing else.
 *
 * ## Why the icon is a bare silhouette and not the app chip
 *
 * The brand's chip rule says that when referring to OpenStation as a
 * product, the mark sits on its Void app tile and never bare. A dock
 * tile looks like exactly that kind of reference, and the first version
 * of this file shipped the chip for that reason. **It rendered as a
 * plain white rounded square.**
 *
 * The dock does not paint icons; it paints their *alpha*. Every image
 * icon goes through `_makeSvgIcon()` in `src/dock.ts`, which masks the
 * art with `currentColor` so a plugin's brand colours cannot break the
 * monochrome rail its dashicon neighbours live on. A chip's alpha is
 * the tile, so masking one yields the tile and nothing else — the mark
 * is knocked out of a shape that is now a solid block of dock-icon
 * colour. No amount of colour inside the SVG can survive a mask, so the
 * chip is not a thing the dock is able to render, whatever the brand
 * would prefer.
 *
 * Drawn in `currentColor` instead, the mark is a silhouette, and both
 * paint paths do the right thing with it: the dock masks it to
 * `--os-dock-icon-color`, and `renderIcon()` recognises the keyword
 * (see `isSilhouetteSvg` in `src/icon.ts`) and masks it to the title
 * bar's own text colour. That last part also settles the legibility
 * problem the chip was introduced to solve — a mark that takes the
 * surface's colour is readable on a dark title bar and a light one
 * without carrying its own ground.
 *
 * The chip stays correct where a chip can actually be drawn: the wp.org
 * listing, social, app listings. It is not this file's job.
 *
 * ## Why no mesh
 *
 * Holomesh may fill the mark, but meshes are reserved for hero surfaces
 * and a 20px dock glyph is not one. It would not survive the mask
 * either, for the reason above.
 */

/** Path data for the logomark, in the brand's own 80×80 viewBox. */
const LOGOMARK_PATH =
	'M38.792 0.0186131C60.8846 -0.649069 79.3313 16.7291 79.9824 38.8223C80.6326 60.8921 63.2773 79.3149 41.208 79.9815C19.1385 80.6488 0.702853 63.3074 0.0195305 41.2383C-0.66441 19.1462 16.6995 0.686396 38.792 0.0186131ZM38.71 9.36236C35.8339 7.89166 32.7628 8.23954 29.8555 9.28033C12.6582 14.7114 3.37017 33.8997 9.45508 50.8067C11.0384 55.2047 13.565 59.4989 16.9609 62.7842C21.6294 67.5336 27.6536 70.7223 34.2061 71.9112C37.0214 72.4165 41.0083 73.0707 43.2295 70.7891C46.4143 67.5174 44.115 64.4383 43.1133 60.8419C42.137 57.2757 41.6165 53.6009 41.5635 49.9044C41.5398 46.776 42.201 42.473 42.8252 39.3565C44.2979 32.0039 46.892 24.7246 44.5537 17.2452C43.5137 14.0551 41.8086 10.9469 38.71 9.36236Z';

/** Starlight — the mark's flat fill where a surface cannot supply one. */
const STARLIGHT = '#fffbff';

/**
 * The mark as standalone SVG source, drawn in `currentColor`.
 *
 * The `currentColor` is load-bearing, not a default: it is the
 * declaration that routes this art down the mask path in both painters.
 * Replacing it with a literal silently turns the icon back into a
 * background-image in the title bar and into a solid blob in the dock.
 */
export const OPENSTATION_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><path d="${ LOGOMARK_PATH }" fill="currentColor"/></svg>`;

/**
 * The same art as a base64 data URI, ready for `renderIcon()` and for
 * any `icon:` field in the dock / desktop-icon / window APIs.
 */
export const OPENSTATION_MARK_ICON = `data:image/svg+xml;base64,${ btoa(
	OPENSTATION_MARK_SVG,
) }`;

/**
 * The mark with the brand's flat Starlight fill, sized by CSS.
 *
 * For surfaces that paint it directly rather than through an icon slot,
 * where there is no mask to survive and the colour should be the
 * brand's rather than whatever the surface inherits. The rebrand
 * announcement uses this: the mark is the subject there, not a glyph
 * labelling something else.
 */
export const OPENSTATION_LOGOMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="${ LOGOMARK_PATH }" fill="${ STARLIGHT }"/></svg>`;
