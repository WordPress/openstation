/**
 * The shipped workspace templates, and the registry plugins add to.
 *
 * Three desks ship, and they are three different jobs rather than
 * three arrangements of the same one:
 *
 * - **Commerce** — a shop floor. Orders, products and analytics are
 *   things you compare, so they land in columns, and everything that
 *   is not commerce leaves the rails.
 * - **Learning** — a course studio. Courses, lessons and learners are
 *   a set you move between, so they tile.
 * - **Publishing** — a writing desk. A blank page takes two thirds of
 *   the screen and the library sits in the margin. It is the one
 *   preset whose point is what it leaves OUT.
 *
 * **Named for the job, not for the plugin.** A desk called "Woo" is
 * wrong on a store running something else, and wrong again the day the
 * product is renamed — but the WORK is commerce either way. The
 * products are still what the templates reach for: the tokens below
 * name WooCommerce and Sensei directly, and on a site that has them
 * the Commerce desk is a WooCommerce desk in everything but its
 * label. On a site that does not, it degrades to the core menus its
 * tokens still match rather than promising a product that isn't there.
 *
 * Presets are templates: {@link workspaceProfileFromPreset} reads one
 * once, against the navigation as it stands, and what lands on the
 * desktop is concrete data. Editing a workspace afterwards never
 * writes back here, and changing a preset in a later release never
 * reaches a desk already created from it.
 */

import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import type { NavItem } from '../nav/types';
import { resolveAppIds } from './match';
import type { WorkspacePreset, WorkspaceProfile } from './types';

/**
 * Core menus every workspace keeps, whatever it is about.
 *
 * Not a courtesy — a desk with no Dashboard, no Media and no Settings
 * is a dead end, and the user would have to leave the workspace to do
 * anything the template's author did not think of. Merged into every
 * preset's own token list.
 */
const ALWAYS_KEEP: readonly string[] = [
	'index.php',
	'upload.php',
	'options-general.php',
];

/**
 * Built-in templates.
 *
 * Not a `const` array the module exports directly: the registry below
 * is what callers read, so a plugin's preset and a shipped one are the
 * same kind of thing to every consumer.
 */
function builtInPresets(): WorkspacePreset[] {
	return [
		{
			id: 'commerce',
			label: __( 'Commerce' ),
			description: __(
				'A shop floor. WooCommerce orders, products and analytics side by side; everything that is not commerce leaves the rails.',
			),
			icon: 'dashicons-cart',
			// WooCommerce purple — the label is generic, the desk is
			// still built around the product.
			color: '#7f54b3',
			defaultLabel: __( 'Commerce' ),
			order: 10,
			apps: [
				'woocommerce',
				'wc-admin',
				'wc-orders',
				'wc-reports',
				'wc-settings',
				'post_type=product',
				'post_type=shop_order',
				'post_type=shop_coupon',
				'edit-tags.php?taxonomy=product_cat',
				'users.php',
			],
			// A shop floor watches traffic and the clock; it has no use
			// for a drafts list.
			widgets: [ 'clock', 'desktop-mode/site-views' ],
			// A shop floor is a working surface: a flat dark ground so
			// three columns of tables read cleanly, and the accent
			// nearest Woo's own purple.
			appearance: {
				wallpaper: 'dark',
				accent: 'indigo',
			},
			windows: [
				{ match: 'wc-orders' },
				{
					match: 'post_type=product',
					url: 'edit.php?post_type=product',
				},
				{ match: 'wc-admin' },
			],
			layout: 'columns',
		},
		{
			id: 'learning',
			label: __( 'Learning' ),
			description: __(
				'A course studio. Sensei courses, lessons and learners tiled together, so moving between them is a glance rather than a navigation.',
			),
			icon: 'dashicons-welcome-learn-more',
			// Sensei green.
			color: '#43a047',
			defaultLabel: __( 'Learning' ),
			order: 20,
			apps: [
				'sensei',
				'post_type=course',
				'post_type=lesson',
				'post_type=question',
				'post_type=sensei_message',
				'sensei_learner_admin',
				'sensei-settings',
				'users.php',
			],
			// A studio wants the room's pulse: who is around, what is
			// being said, and the clock a lesson is timed against.
			widgets: [
				'clock',
				'desktop-mode/heartbeat',
				'desktop-mode/recent-comments',
			],
			// A studio is a room with people in it — the aurora ground
			// and Sensei's green.
			appearance: {
				wallpaper: 'aurora',
				accent: 'emerald',
			},
			windows: [
				{ match: 'post_type=course', url: 'edit.php?post_type=course' },
				{ match: 'post_type=lesson', url: 'edit.php?post_type=lesson' },
				{ match: 'sensei' },
			],
			layout: 'tile',
		},
		{
			id: 'publishing',
			label: __( 'Publishing' ),
			description: __(
				'A writing desk. A blank page takes two thirds of the screen, the library sits in the margin, and the rest of the admin is somewhere else.',
			),
			icon: 'dashicons-edit-page',
			// Editorial red.
			color: '#c8102e',
			defaultLabel: __( 'Publishing' ),
			order: 30,
			apps: [
				'edit.php',
				'post-new.php',
				'upload.php',
				'edit-comments.php',
				'edit-tags.php',
				'post_type=page',
			],
			// The desk's own instruments: what is unfinished, how much
			// has been written, a timer, and a note to yourself. No
			// traffic chart — this desk is about the page, not the
			// audience, and the point of the whole template is what it
			// leaves out.
			widgets: [
				'desktop-mode/drafts',
				'desktop-mode/post-stats',
				'desktop-mode/focus-timer',
				'desktop-mode/notes',
			],
			// The quietest ground there is, and a dock that folds away
			// to a line until reached for. A writing desk should have
			// nothing on it that is not the page — this is the same
			// argument as the app list, made in paint.
			appearance: {
				wallpaper: 'mono',
				accent: 'rose',
				dockBehavior: 'dynamic',
			},
			windows: [
				{
					match: 'edit.php',
					url: 'post-new.php',
					title: __( 'New draft' ),
				},
				{ match: 'edit.php', url: 'edit.php' },
			],
			layout: 'focus',
		},
	];
}

/** Plugin-registered presets, in registration order. */
const registered = new Map< string, WorkspacePreset >();

/**
 * Register a workspace template.
 *
 * Re-registering an id replaces the previous entry, which is what lets
 * a plugin's server-synced preset land twice (boot payload, then a
 * live menu refresh) without doubling up.
 */
export function registerWorkspacePreset( preset: WorkspacePreset ): void {
	if ( ! preset?.id ) {
		return;
	}
	registered.set( preset.id, preset );
}

/** Drop a registered preset. Built-ins cannot be removed this way. */
export function unregisterWorkspacePreset( id: string ): void {
	registered.delete( id );
}

/**
 * Every template, built-ins and plugin registrations together, sorted
 * by `order`.
 *
 * Filterable so a site can drop a shipped preset it has no use for —
 * a blog with no store has no reason to be offered a Commerce desk.
 */
export function listWorkspacePresets(): WorkspacePreset[] {
	const all = [ ...builtInPresets(), ...registered.values() ];
	const filtered = applyFilters< WorkspacePreset[], [] >(
		HOOKS.WORKSPACE_PRESETS,
		all,
	);
	const list = Array.isArray( filtered ) ? filtered.slice() : all;
	return list
		.map( ( preset, index ) => ( { preset, index } ) )
		.sort(
			( a, b ) =>
				( a.preset.order ?? 0 ) - ( b.preset.order ?? 0 ) ||
				a.index - b.index,
		)
		.map( ( entry ) => entry.preset );
}

/** One template by id, or `null`. */
export function findWorkspacePreset( id: string ): WorkspacePreset | null {
	return listWorkspacePresets().find( ( p ) => p.id === id ) ?? null;
}

/**
 * Read a template into the concrete profile a desktop carries.
 *
 * `items` is the navigation as it stands right now — the whole reason
 * a preset resolves at creation time rather than on every repaint. A
 * workspace is a decision the user made about the apps that existed
 * when they made it; a plugin activated tomorrow does not silently
 * join a desk that was narrowed yesterday.
 */
export function workspaceProfileFromPreset(
	preset: WorkspacePreset,
	items: readonly NavItem[],
): WorkspaceProfile {
	const tokens = [ ...preset.apps, ...( preset.apps.length ? ALWAYS_KEEP : [] ) ];
	const ids = resolveAppIds( items, tokens );
	const widgets = preset.widgets ?? [];
	return {
		preset: preset.id,
		icon: preset.icon,
		color: preset.color,
		apps: {
			// A template that names no apps is a layout, not a filter.
			mode: preset.apps.length > 0 ? 'only' : 'all',
			ids,
		},
		widgets: {
			// A template with no opinion about widgets leaves the
			// user's own column alone. Widget ids are registry keys, so
			// unlike apps they are named exactly and need no resolving;
			// one whose plugin is absent is simply skipped at mount.
			mode: widgets.length > 0 ? 'only' : 'all',
			ids: widgets.slice(),
		},
		// Copied, not shared: a profile is mutable data the user edits
		// from here on, and a template must not be editable through the
		// desks made from it.
		appearance: { ...( preset.appearance ?? {} ) },
		windows: preset.windows.map( ( w ) => ( { ...w } ) ),
		layout: preset.layout,
		// The launch list has not run yet — that is what entering the
		// workspace for the first time does.
		provisioned: false,
	};
}
