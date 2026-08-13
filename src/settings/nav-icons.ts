/**
 * The glyphs down the left of OpenStation Preferences.
 *
 * ## Which icons are ours to draw
 *
 * Core owns the verbs, OpenStation owns the nouns. If WordPress
 * already has a concept, its icon comes from Core and looks like every
 * other Core icon the user has ever seen; we draw one only when the
 * thing exists *because* this is a desktop and wp-admin is not.
 *
 * By that rule five of the eight below are Core shapes (Appearance,
 * Themes, Features, File Associations, About) and three are ours
 * (Windows, Apps, Components). A window you can drag is not a
 * WordPress concept.
 *
 * ## Why they are inline SVG and not `<os-icon>`
 *
 * `<os-icon>` is a Dashicons wrapper, and Dashicons is a frozen icon
 * font with no dock, no window and no widget-grid in it. The four
 * OpenStation shapes simply do not exist there, and mixing four
 * hand-drawn SVGs with four font glyphs in one column would show:
 * the font renders at its own weight and optical size and would sit
 * visibly heavier than the 1.5-stroke shapes beside it.
 *
 * ## The two drawing languages, and why both are here
 *
 * Core's icons are FILLED (solid paths, square joins). Ours are
 * monoline: 24x24 grid, 20x20 live area, 1.5 stroke, corner radius 2,
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

import { html } from '../ui/core';
import type { TemplateResult } from '../ui/core';

/**
 * Partial because most ids have no glyph: only the built-in pages
 * (plus the shell's own registry-delivered File Associations tab)
 * are drawn here, and indexing this with anything else has to type
 * as `undefined` so the caller is made to handle it.
 */
type NavIconMap = Readonly< Partial< Record< string, TemplateResult > > >;

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
	appearance: html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M17.2 10.9c-.5-1-1.2-2.1-2.1-3.2-.6-.9-1.3-1.7-2.1-2.6L12 4l-1 1.1c-.6.9-1.3 1.7-2 2.6-.8 1.2-1.5 2.3-2 3.2-.6 1.2-1 2.2-1 3 0 3.4 2.7 6.1 6.1 6.1s6.1-2.7 6.1-6.1c0-.8-.3-1.8-1-3zm-5.1 7.6c-2.5 0-4.6-2.1-4.6-4.6 0-.3.1-1 .8-2.3.5-.9 1.1-1.9 2-3.1.7-.9 1.3-1.7 1.8-2.3.7.8 1.3 1.6 1.8 2.3.8 1.1 1.5 2.2 2 3.1.7 1.3.8 2 .8 2.3 0 2.5-2.1 4.6-4.6 4.6z"
		/>
	</svg>`,

	/*
	 * Core. The half-filled disc, Core's contrast glyph: a theme is one
	 * look swapped for another.
	 */
	themes: html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			fill-rule="evenodd"
			clip-rule="evenodd"
			d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 0 1-6.5 6.5v-13a6.5 6.5 0 0 1 6.5 6.5Z"
		/>
	</svg>`,

	/*
	 * Ours. Two frames, overlapping, the front one with a title bar.
	 * The overlap is the whole idea: a single frame is a page, and
	 * pages are what wp-admin already had.
	 */
	windows: html`<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="8" width="13" height="11.5" rx="2.5" />
		<path d="M2.5 12h13" />
		<path d="M8 8V7a2.5 2.5 0 0 1 2.5-2.5h8A2.5 2.5 0 0 1 21 7v7a2.5 2.5 0 0 1-2.5 2.5h-3" />
	</svg>`,

	/*
	 * Ours. Four tiles: the launcher grid, not a plug or a puzzle
	 * piece. This page is about where an app SITS (dock, desktop,
	 * nowhere), which is a placement question, so the icon is the
	 * arrangement rather than the thing being arranged.
	 */
	'apps-icons': html`<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M5 3h3.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
		<path d="M15.5 3H19a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
		<path d="M5 13.5h3.5a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2Z" />
		<path d="M15.5 13.5H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2Z" />
	</svg>`,

	/*
	 * Core. The sliders Core uses for settings that are switches
	 * rather than content, which is exactly what this page is: opt-ins,
	 * developer mode, the betas.
	 */
	features: html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="m19 7.5h-7.628c-.3089-.87389-1.1423-1.5-2.122-1.5-.97966 0-1.81309.62611-2.12197 1.5h-2.12803v1.5h2.12803c.30888.87389 1.14231 1.5 2.12197 1.5.9797 0 1.8131-.62611 2.122-1.5h7.628z"
		/>
		<path
			d="m19 15h-2.128c-.3089-.8739-1.1423-1.5-2.122-1.5s-1.8131.6261-2.122 1.5h-7.628v1.5h7.628c.3089.8739 1.1423 1.5 2.122 1.5s1.8131-.6261 2.122-1.5h2.128z"
		/>
	</svg>`,

	/*
	 * Ours. Panes of unequal size, which is the widget vocabulary: a
	 * grid of four equal squares is already the Apps glyph above, and
	 * the two pages would be indistinguishable at 17px.
	 */
	help: html`<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
		<rect x="15.5" y="2.5" width="6" height="6" rx="2" />
		<rect x="15.5" y="10.5" width="6" height="11" rx="2" />
		<rect x="2.5" y="15.5" width="11" height="6" rx="2" />
	</svg>`,

	/*
	 * Core. The page glyph: a file association is a question about
	 * documents, and Core already has the word for a document.
	 * Keyed on the desktop-files feature's registered tab id, which
	 * is ours even though it arrives through the settings-tab
	 * registry: the registry has no icon field for third parties,
	 * but the shell may know its own features by name.
	 */
	'os-file-associations': html`<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			d="M15.5 7.5h-7V9h7V7.5Zm-7 3.5h7v1.5h-7V11Zm7 3.5h-7V16h7v-1.5Z"
		/>
		<path
			d="M17 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM7 5.5h10a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z"
		/>
	</svg>`,

	/*
	 * Core. The information disc, unchanged, because this is the one
	 * page in the panel that is not about the desktop at all.
	 */
	about: html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			fill-rule="evenodd"
			clip-rule="evenodd"
			d="M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0ZM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4v1.5h-1.5V8h1.5Zm0 8v-5h-1.5v5h1.5Z"
		/>
	</svg>`,
};
