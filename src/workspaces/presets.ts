import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import type { NavItem } from '../nav/types';
import { resolveAppIds } from './match';
import type { WorkspacePreset, WorkspaceProfile } from './types';

const ALWAYS_KEEP: readonly string[] = [
	'index.php',
	'upload.php',
	'options-general.php',
];

function builtInPresets(): WorkspacePreset[] {
	return [
		{
			id: 'commerce',
			label: __( 'Commerce' ),
			description: __(
				'A shop floor. WooCommerce orders, products and analytics side by side; everything that is not commerce leaves the rails.',
			),
			icon: 'dashicons-cart',

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

			widgets: [ 'clock', 'desktop-mode/site-views' ],

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

			widgets: [
				'clock',
				'desktop-mode/heartbeat',
				'desktop-mode/recent-comments',
			],

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

			widgets: [
				'desktop-mode/drafts',
				'desktop-mode/post-stats',
				'desktop-mode/focus-timer',
				'desktop-mode/notes',
			],

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

const registered = new Map< string, WorkspacePreset >();

export function registerWorkspacePreset( preset: WorkspacePreset ): void {
	if ( ! preset?.id ) {
		return;
	}
	registered.set( preset.id, preset );
}

export function unregisterWorkspacePreset( id: string ): void {
	registered.delete( id );
}

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

export function findWorkspacePreset( id: string ): WorkspacePreset | null {
	return listWorkspacePresets().find( ( p ) => p.id === id ) ?? null;
}

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

			mode: preset.apps.length > 0 ? 'only' : 'all',
			ids,
		},
		widgets: {

			mode: widgets.length > 0 ? 'only' : 'all',
			ids: widgets.slice(),
		},

		appearance: { ...( preset.appearance ?? {} ) },
		windows: preset.windows.map( ( w ) => ( { ...w } ) ),
		layout: preset.layout,

		provisioned: false,
	};
}
