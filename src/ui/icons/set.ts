/**
 * The thirty icons the shell draws.
 *
 * **Generated. Do not edit by hand.** The drawings live in the brand
 * repository; `branding/icons/tools/emit-shell-icons.py` writes this
 * file from them. Editing a path here is lost on the next run, and
 * silently disagrees with the copies in `assets/icons/`, the sprite
 * and the Figma library in the meantime.
 *
 * ## Core owns the verbs, OpenStation owns the nouns
 *
 * Nineteen of these are WordPress's own icons, taken from
 * `@wordpress/icons` so that save, search, trash and settings look
 * like they do in every other WordPress screen the user has seen.
 * Eleven are drawn here, and only because they are *station
 * vocabulary*: window, dock, spaces, snap and the rest exist because
 * this is a desktop and wp-admin is not. A generic verb is never
 * drawn locally.
 *
 * ## Why the set is data and not a dependency
 *
 * `@wordpress/icons` ships React elements built on
 * `@wordpress/primitives`. The shell is IIFE bundles with its own
 * ~400-line tagged-template renderer and no React, so importing the
 * package would pull a framework in behind twelve paths. There is no
 * `wp-icons` script handle to depend on instead, and `wp_get_icon()`
 * is PHP-only and lands in WordPress 7.1, above our 6.0 floor. So the
 * artwork travels as data. Upstream's paths are copied verbatim; a
 * fix upstream is re-exported, never re-drawn.
 *
 * ## The two drawing languages
 *
 * Core's icons are FILLED: solid paths, square joins. Ours are
 * monoline: 24x24 grid, 17.5 live area, 1.5 stroke, corner radius 2,
 * `currentColor` throughout. Standing them side by side is deliberate:
 * a Core icon redrawn as monoline stops being recognisable as the Core
 * icon, which was the whole reason for borrowing it.
 *
 * Everything is `currentColor`, never a hex, so an icon inherits its
 * colour from whatever it sits in, including the mask paths in the
 * dock and title-bar painters, which only work on monochrome art.
 *
 * ## Sizing
 *
 * The default is 24, Core's native size and the size WordPress renders
 * these at. Below 16 a filled Core glyph goes faint: its strokes are
 * 1.5 units on a 24 grid, so at 10px they are 0.6px wide. Where the
 * shell used to hand-draw a heavier glyph for a small box, the icon
 * now comes from the set and the box grows to 16 instead.
 */

/** Every icon in the set. */
export type OsIconName =
	| 'close'
	| 'check'
	| 'chevron-right'
	| 'arrow-up-right'
	| 'plus'
	| 'search'
	| 'pin'
	| 'trash'
	| 'download'
	| 'settings'
	| 'info'
	| 'bell'
	| 'more'
	| 'maximize'
	| 'edit'
	| 'color'
	| 'wallpaper'
	| 'warning'
	| 'minimize'
	| 'window'
	| 'windows'
	| 'dock'
	| 'spaces'
	| 'copilot'
	| 'snap'
	| 'command'
	| 'apps'
	| 'widgets'
	| 'user'
	| 'lock';

/**
 * One drawing: `a` is the root `<svg>`'s own attributes (what makes
 * Core's filled and ours monoline), `b` its shapes. Short keys because
 * this table is generated and read by machine far more often than by
 * a person.
 */
export interface OsIconDef {
	readonly a: string;
	readonly b: string;
}

/** The nineteen that come from WordPress. */
export const OS_CORE_ICON_NAMES: readonly OsIconName[] = [
	'close', 'check', 'chevron-right', 'arrow-up-right', 'plus', 'search', 'pin', 'trash', 'download', 'settings', 'info', 'bell', 'more', 'maximize', 'edit', 'color', 'wallpaper', 'warning', 'minimize',
];

/** The eleven that are ours to draw. */
export const OS_OWN_ICON_NAMES: readonly OsIconName[] = [
	'window', 'windows', 'dock', 'spaces', 'copilot', 'snap', 'command', 'apps', 'widgets', 'user', 'lock',
];

/** Every name, Core's first, in the set's documented order. */
export const OS_ICON_NAMES: readonly OsIconName[] = [
	...OS_CORE_ICON_NAMES,
	...OS_OWN_ICON_NAMES,
];

/** The artwork, keyed by name. */
export const OS_ICONS: Readonly< Record< OsIconName, OsIconDef > > = {
	/** Core's `close`. */
	close: {
		a: 'fill="currentColor"',
		b: '<path d="m13.06 12 6.47-6.47-1.06-1.06L12 10.94 5.53 4.47 4.47 5.53 10.94 12l-6.47 6.47 1.06 1.06L12 13.06l6.47 6.47 1.06-1.06L13.06 12Z" />',
	},
	/** Core's `check`. */
	check: {
		a: 'fill="currentColor"',
		b: '<path d="M16.5 7.5 10 13.9l-2.5-2.4-1 1 3.5 3.6 7.5-7.6z" />',
	},
	/** Core's `chevron-right`. */
	'chevron-right': {
		a: 'fill="currentColor"',
		b: '<path d="M10.6 6L9.4 7l4.6 5-4.6 5 1.2 1 5.4-6z" />',
	},
	/** Core's `arrow-up-right`. */
	'arrow-up-right': {
		a: 'fill="currentColor"',
		b: '<path d="M10 6H18V14H16.5V8.5L7 18L6 17L15.5 7.5H10V6Z" />',
	},
	/** Core's `plus`. */
	plus: {
		a: 'fill="currentColor"',
		b: '<path d="M11 12.5V17.5H12.5V12.5H17.5V11H12.5V6H11V11H6V12.5H11Z" />',
	},
	/** Core's `search`. */
	search: {
		a: 'fill="currentColor"',
		b: '<path d="M13 5c-3.3 0-6 2.7-6 6 0 1.4.5 2.7 1.3 3.7l-3.8 3.8 1.1 1.1 3.8-3.8c1 .8 2.3 1.3 3.7 1.3 3.3 0 6-2.7 6-6S16.3 5 13 5zm0 10.5c-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5 4.5 2 4.5 4.5-2 4.5-4.5 4.5z" />',
	},
	/** Core's `pin`. */
	pin: {
		a: 'fill="currentColor"',
		b: '<path d="m21.5 9.1-6.6-6.6-4.2 5.6c-1.2-.1-2.4.1-3.6.7-.1 0-.1.1-.2.1-.5.3-.9.6-1.2.9l3.7 3.7-5.7 5.7v1.1h1.1l5.7-5.7 3.7 3.7c.4-.4.7-.8.9-1.2.1-.1.1-.2.2-.3.6-1.1.8-2.4.6-3.6l5.6-4.1zm-7.3 3.5.1.9c.1.9 0 1.8-.4 2.6l-6-6c.8-.4 1.7-.5 2.6-.4l.9.1L15 4.9 19.1 9l-4.9 3.6z" />',
	},
	/** Core's `trash`. */
	trash: {
		a: 'fill="currentColor"',
		b: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 5.5A2.25 2.25 0 0 0 9.878 7h4.244A2.251 2.251 0 0 0 12 5.5ZM12 4a3.751 3.751 0 0 0-3.675 3H5v1.5h1.27l.818 8.997a2.75 2.75 0 0 0 2.739 2.501h4.347a2.75 2.75 0 0 0 2.738-2.5L17.73 8.5H19V7h-3.325A3.751 3.751 0 0 0 12 4Zm4.224 4.5H7.776l.806 8.861a1.25 1.25 0 0 0 1.245 1.137h4.347a1.25 1.25 0 0 0 1.245-1.137l.805-8.861Z" />',
	},
	/** Core's `download`. */
	download: {
		a: 'fill="currentColor"',
		b: '<path d="M18 11.3l-1-1.1-4 4V3h-1.5v11.3L7 10.2l-1 1.1 6.2 5.8 5.8-5.8zm.5 3.7v3.5h-13V15H4v5h16v-5h-1.5z" />',
	},
	/** Core's `settings`. */
	settings: {
		a: 'fill="currentColor"',
		b: '<path d="m19 7.5h-7.628c-.3089-.87389-1.1423-1.5-2.122-1.5-.97966 0-1.81309.62611-2.12197 1.5h-2.12803v1.5h2.12803c.30888.87389 1.14231 1.5 2.12197 1.5.9797 0 1.8131-.62611 2.122-1.5h7.628z" /><path d="m19 15h-2.128c-.3089-.8739-1.1423-1.5-2.122-1.5s-1.8131.6261-2.122 1.5h-7.628v1.5h7.628c.3089.8739 1.1423 1.5 2.122 1.5s1.8131-.6261 2.122-1.5h2.128z" />',
	},
	/** Core's `info`. */
	info: {
		a: 'fill="currentColor"',
		b: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0ZM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4v1.5h-1.5V8h1.5Zm0 8v-5h-1.5v5h1.5Z" />',
	},
	/** Core's `bell`. */
	bell: {
		a: 'fill="currentColor"',
		b: '<path fill-rule="evenodd" clip-rule="evenodd" d="M17 11.5c0 1.353.17 2.368.976 3 .266.209.602.376 1.024.5v1H5v-1c.422-.124.757-.291 1.024-.5.806-.632.976-1.647.976-3V9c0-2.8 2.2-5 5-5s5 2.2 5 5v2.5ZM15.5 9v2.5c0 .93.066 1.98.515 2.897l.053.103H7.932a4.018 4.018 0 0 0 .053-.103c.449-.917.515-1.967.515-2.897V9c0-1.972 1.528-3.5 3.5-3.5s3.5 1.528 3.5 3.5Zm-5.492 9.008c0-.176.023-.346.065-.508h3.854A1.996 1.996 0 0 1 12 20c-1.1 0-1.992-.892-1.992-1.992Z" />',
	},
	/** Core's `more-horizontal`, under the name the shell uses for it. */
	more: {
		a: 'fill="currentColor"',
		b: '<path d="M11 13h2v-2h-2v2zm-6 0h2v-2H5v2zm12-2v2h2v-2h-2z" />',
	},
	/** Core's `fullscreen`, under the name the shell uses for it. */
	maximize: {
		a: 'fill="currentColor"',
		b: '<path d="M6 4a2 2 0 0 0-2 2v3h1.5V6a.5.5 0 0 1 .5-.5h3V4H6Zm3 14.5H6a.5.5 0 0 1-.5-.5v-3H4v3a2 2 0 0 0 2 2h3v-1.5Zm6 1.5v-1.5h3a.5.5 0 0 0 .5-.5v-3H20v3a2 2 0 0 1-2 2h-3Zm3-16a2 2 0 0 1 2 2v3h-1.5V6a.5.5 0 0 0-.5-.5h-3V4h3Z" />',
	},
	/** Core's `pencil`, under the name the shell uses for it. */
	edit: {
		a: 'fill="currentColor"',
		b: '<path d="m19 7-3-3-8.5 8.5-1 4 4-1L19 7Zm-7 11.5H5V20h7v-1.5Z" />',
	},
	/** Core's `color`. */
	color: {
		a: 'fill="currentColor"',
		b: '<path d="M17.2 10.9c-.5-1-1.2-2.1-2.1-3.2-.6-.9-1.3-1.7-2.1-2.6L12 4l-1 1.1c-.6.9-1.3 1.7-2 2.6-.8 1.2-1.5 2.3-2 3.2-.6 1.2-1 2.2-1 3 0 3.4 2.7 6.1 6.1 6.1s6.1-2.7 6.1-6.1c0-.8-.3-1.8-1-3zm-5.1 7.6c-2.5 0-4.6-2.1-4.6-4.6 0-.3.1-1 .8-2.3.5-.9 1.1-1.9 2-3.1.7-.9 1.3-1.7 1.8-2.3.7.8 1.3 1.6 1.8 2.3.8 1.1 1.5 2.2 2 3.1.7 1.3.8 2 .8 2.3 0 2.5-2.1 4.6-4.6 4.6z" />',
	},
	/** Core's `image`, under the name the shell uses for it. */
	wallpaper: {
		a: 'fill="currentColor"',
		b: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 4.5h14c.3 0 .5.2.5.5v8.4l-3-2.9c-.3-.3-.8-.3-1 0L11.9 14 9 12c-.3-.2-.6-.2-.8 0l-3.6 2.6V5c-.1-.3.1-.5.4-.5zm14 15H5c-.3 0-.5-.2-.5-.5v-2.4l4.1-3 3 1.9c.3.2.7.2.9-.1L16 12l3.5 3.4V19c0 .3-.2.5-.5.5z" />',
	},
	/** Core's `caution`, under the name the shell uses for it. */
	warning: {
		a: 'fill="currentColor"',
		b: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0ZM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-.75 12v-1.5h1.5V16h-1.5Zm0-8v5h1.5V8h-1.5Z" />',
	},
	/** Core's `line-solid`, under the name the shell uses for it. */
	minimize: {
		a: 'fill="currentColor"',
		b: '<path d="M5 11.25h14v1.5H5z" />',
	},
	/** Ours. A frame with a title bar. The desktop's atom. */
	window: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="4.125" y="5.4375" width="15.75" height="13.125" rx="1.75"/><path d="M4.125 9.8125h15.75"/><circle cx="7.275" cy="7.625" r="0.7438" fill="currentColor" stroke="none"/>',
	},
	/** Ours. Two frames, overlapping. A single frame is a page; pages are what wp-admin already had. */
	windows: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="3.6875" y="8.5" width="11.375" height="10.0625" rx="1.75"/><path d="M3.6875 12h11.375"/><path d="M8.5 8.5V7.1875a1.75 1.75 0 0 1 1.75-1.75h7.875A1.75 1.75 0 0 1 19.875 7.1875v7a1.75 1.75 0 0 1-1.75 1.75h-3.0625"/>',
	},
	/** Ours. The rail, as a pill with three running dots. */
	dock: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="3.25" y="8.5" width="17.5" height="7" rx="3.5"/><circle cx="7.625" cy="12" r="1.0062" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.0062" fill="currentColor" stroke="none"/><circle cx="16.375" cy="12" r="1.0062" fill="currentColor" stroke="none"/>',
	},
	/** Ours. Two screens over a page indicator. Virtual desktops. */
	spaces: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="3.6875" y="5.4375" width="7.4375" height="7.875" rx="1.75"/><rect x="12.875" y="5.4375" width="7.4375" height="7.875" rx="1.75"/><circle cx="9.375" cy="17.6875" r="0.7875" fill="currentColor" stroke="none"/><circle cx="12" cy="17.6875" r="0.7875" fill="currentColor" stroke="none"/><circle cx="14.625" cy="17.6875" r="0.7875" fill="currentColor" stroke="none"/>',
	},
	/** Ours. The brand sparkle. Two four-point stars, filled. */
	copilot: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<path d="M10 2.5Q10.9 8.5 17.5 10Q10.9 11.5 10 17.5Q9.1 11.5 2.5 10Q9.1 8.5 10 2.5Z" fill="currentColor" stroke="none"/><path d="M17.9 14Q18.35 17.1 21.5 17.6Q18.35 18.1 17.9 21.2Q17.45 18.1 14.3 17.6Q17.45 17.1 17.9 14Z" fill="currentColor" stroke="none"/>',
	},
	/** Ours. A frame split down the middle. Window tiling. */
	snap: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="3.6875" y="5.4375" width="16.625" height="13.125" rx="1.75"/><path d="M12 5.4375v13.125"/><path d="M12 12h8.3125"/>',
	},
	/** Ours. The looped command mark. The palette. */
	command: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<path d="M14.625 6.75v10.5a2.625 2.625 0 1 0 2.625-2.625H6.75a2.625 2.625 0 1 0 2.625 2.625V6.75a2.625 2.625 0 1 0-2.625 2.625h10.5a2.625 2.625 0 1 0-2.625-2.625"/>',
	},
	/** Ours. Four tiles. The launcher grid, not a plug or a puzzle piece. */
	apps: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="4.125" y="4.125" width="6.5625" height="6.5625" rx="1.75"/><rect x="13.3125" y="4.125" width="6.5625" height="6.5625" rx="1.75"/><rect x="4.125" y="13.3125" width="6.5625" height="6.5625" rx="1.75"/><rect x="13.3125" y="13.3125" width="6.5625" height="6.5625" rx="1.75"/>',
	},
	/** Ours. An asymmetric bento. Widgets are panes of different sizes. */
	widgets: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="3.6875" y="3.6875" width="9.625" height="9.625" rx="1.75"/><rect x="15.0625" y="3.6875" width="5.25" height="5.25" rx="1.75"/><rect x="15.0625" y="10.6875" width="5.25" height="9.625" rx="1.75"/><rect x="3.6875" y="15.0625" width="9.625" height="5.25" rx="1.75"/>',
	},
	/** Ours. Head and shoulders. */
	user: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<circle cx="12" cy="8.9375" r="3.5"/><path d="M5.4375 19.4375a6.5625 6.5625 0 0 1 13.125 0"/>',
	},
	/** Ours. A shackle over a body. The lock screen. */
	lock: {
		a: 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
		b: '<rect x="5.4375" y="10.6875" width="13.125" height="8.75" rx="1.75"/><path d="M8.5 10.6875V8.0625a3.5 3.5 0 0 1 7 0v2.625"/>',
	},
};
