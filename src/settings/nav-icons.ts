/**
 * The glyphs down the left of OpenStation Preferences.
 *
 * ## Which icons are ours to draw
 *
 * Core owns the verbs, OpenStation owns the nouns. If WordPress
 * already has a concept, its icon comes from Core and looks like every
 * other Core icon the user has ever seen; we draw one only when the
 * thing exists *because* this is a desktop and wp-admin is not. By
 * that rule six of the eight below are Core shapes (Appearance,
 * Themes, Navigation, Features, File Associations, About) and two are
 * ours (Windows, Components). A window you can drag is not a
 * WordPress concept.
 *
 * ## Where the drawings come from
 *
 * Five of the eight resolve out of `src/ui/icons`, the shell's
 * thirty-icon set, so this column and the rest of the shell cannot
 * drift apart. Three are drawn here because the set has no member for
 * them, and each says so at its entry.
 *
 * ## Why not `<os-icon>`
 *
 * `<os-icon>` is a Dashicons wrapper, and Dashicons is a frozen icon
 * font with no dock, no window and no widget-grid in it. The
 * OpenStation shapes simply do not exist there, and mixing hand-drawn
 * SVGs with font glyphs in one column would show: the font renders at
 * its own weight and optical size and would sit visibly heavier than
 * the 1.5-stroke shapes beside it.
 *
 * ## The two drawing languages, and why both are here
 *
 * Core's icons are FILLED (solid paths, square joins). Ours are
 * monoline: 24x24 grid, 17.5 live area, 1.5 stroke, corner radius 2,
 * `currentColor` throughout. Standing them side by side is a
 * deliberate choice rather than an oversight: a Core icon redrawn as
 * monoline stops being recognisable as the Core icon, which was the
 * entire reason for borrowing it. At 17px in a settings sidebar the
 * weight difference reads as texture, not as inconsistency.
 *
 * Everything is `currentColor`, never a hex, so a row inherits its
 * glyph colour from its own hover and selected states rather than
 * needing a second set of rules to keep the two in step.
 */

import { osIcon } from '../ui/icons';

/**
 * Partial because most ids have no glyph: only the built-in pages
 * (plus the shell's own registry-delivered File Associations tab)
 * are drawn here, and indexing this with anything else has to type
 * as `undefined` so the caller is made to handle it.
 *
 * The values are factories rather than elements. An SVG element can
 * only be in one place in the DOM at a time, so a shared module-level
 * node would be moved rather than copied the moment two rows wanted
 * the same glyph. A factory hands each caller its own.
 */
type NavIconMap = Readonly< Partial< Record< string, () => SVGSVGElement > > >;

/** Sidebar glyphs render at 17px; the column's CSS sizes the box. */
const NAV = { size: null } as const;

/**
 * Tab id to glyph. Ids match the `rows` table in `panel.ts`.
 *
 * A tab with no entry renders without a glyph and keeps its label
 * aligned with the rest, which is the case every third-party tab is
 * in: the settings-tab registry has no icon field, so a plugin cannot
 * supply one even if it wanted to. See the note on the empty-icon
 * spacer in `os-settings.css`.
 */
export const NAV_ICONS: NavIconMap = {
	/*
	 * Core. The droplet WordPress uses for colour and styles, which is
	 * what this page is: wallpaper, accent, layout.
	 */
	appearance: () => osIcon( 'color', NAV ),

	/*
	 * Core's `contrast`, drawn here because it is not one of the
	 * thirty: the half-filled disc says "one look swapped for
	 * another", and no member of the set carries that. Kept in Core's
	 * filled language so it sits with the other borrowed glyphs.
	 */
	themes: () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path fill-rule="evenodd" clip-rule="evenodd" d="M20 12a8 8 0' +
			' 1 1-16 0 8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 0 1-6.5 6.5v-13a6.5' +
			' 6.5 0 0 1 6.5 6.5Z" />';
		return svg;
	},

	/*
	 * Ours. Two frames, overlapping, the front one with a title bar.
	 * The overlap is the whole idea: a single frame is a page, and
	 * pages are what wp-admin already had.
	 */
	windows: () => osIcon( 'windows', NAV ),

	/*
	 * Core's `navigation`, drawn here because it is not one of the
	 * thirty: the compass rose says "where things sit and how you get
	 * to them", which is the page, and no member of the set carries
	 * that. The launcher grid this page used to wear is the `apps`
	 * glyph, and the page is no longer only about apps.
	 */
	navigation: () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0' +
			' 14.5c-3.6 0-6.5-2.9-6.5-6.5S8.4 5.5 12 5.5s6.5 2.9 6.5 6.5-2.9' +
			' 6.5-6.5 6.5zM9 16l4.5-3L15 8.4l-4.5 3L9 16z" />';
		return svg;
	},

	/*
	 * Core. The sliders Core uses for settings that are switches
	 * rather than content, which is exactly what this page is: opt-ins,
	 * developer mode, the betas.
	 */
	features: () => osIcon( 'settings', NAV ),

	/*
	 * Ours. Panes of unequal size, which is the widget vocabulary: a
	 * grid of four equal squares is already the Apps glyph above, and
	 * the two pages would be indistinguishable at 17px.
	 */
	help: () => osIcon( 'widgets', NAV ),

	/*
	 * Core's page glyph, drawn here because it is not one of the
	 * thirty: a file association is a question about documents, and
	 * Core already has the word for a document.
	 *
	 * Keyed on the desktop-files feature's registered tab id, which
	 * is ours even though it arrives through the settings-tab
	 * registry: the registry has no icon field for third parties,
	 * but the shell may know its own features by name.
	 */
	'os-file-associations': () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path d="M15.5 7.5h-7V9h7V7.5Zm-7 3.5h7v1.5h-7V11Zm7 3.5h-7V16h7v-1.5Z" />' +
			'<path d="M17 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0' +
			' 2-2V6a2 2 0 0 0-2-2ZM7 5.5h10a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H7a.5.5' +
			' 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z" />';
		return svg;
	},

	/*
	 * Core. The information disc, unchanged, because this is the one
	 * page in the panel that is not about the desktop at all.
	 */
	about: () => osIcon( 'info', NAV ),
};
