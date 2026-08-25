/**
 * Where each kind of thing goes when the user has said nothing.
 *
 * Every default in the shell lives in this file. Attaching a default
 * to the REGISTRATION SITE instead — which is what the old
 * `nativeRail` did — means an app registered in two places has two
 * defaults, and every surface that asks "where does this go?" can get
 * a different answer. Games shipped that way: Preferences read the
 * default off its desktop icon and said "On the desktop" while the
 * dock read the default off its native window and painted a tile.
 */

import type { NavItem, NavKind, NavLayout, NavPlacement, NavRail, NavZone } from './types';

/** Kind → placement when the user has expressed no preference. */
export const DEFAULT_PLACEMENT: Record< NavKind, NavPlacement > = {
	core: 'rail',
	plugin: 'rail',
	app: 'desktop',
	control: 'rail',
};

/**
 * Which physical rail a `'rail'` placement resolves to.
 *
 * The entire layout system is this one line. Core admin menus move to
 * the sidebar in the split layout; everything else is always the dock,
 * because the sidebar IS the WordPress half of that layout and holding
 * anything else would make it mean two things at once.
 *
 * Because the stored value is `'rail'` rather than a rail name,
 * switching layouts is a re-render and never a data migration.
 */
export function railFor( kind: NavKind, layout: NavLayout ): NavRail {
	return 'core' === kind && 'classic' === layout ? 'sidebar' : 'dock';
}

/**
 * Which zone an item sits in. Derived from the kind, never stored —
 * so a drag cannot move an item to another zone, because there is no
 * value a drag could write.
 */
export function zoneFor( kind: NavKind ): NavZone {
	if ( 'core' === kind ) {
		return 'core';
	}
	if ( 'control' === kind ) {
		return 'controls';
	}
	return 'apps';
}

/**
 * The item's effective placement: the user's pick, else the one the
 * registration proposed, else the kind's default.
 *
 * A locked item ignores all three — it is always on the rail.
 */
export function resolvePlacement(
	item: NavItem,
	placement: Record< string, NavPlacement >,
): NavPlacement {
	if ( item.locked ) {
		return 'rail';
	}
	return (
		placement[ item.id ] ??
		item.defaultPlacement ??
		DEFAULT_PLACEMENT[ item.kind ]
	);
}

/** Whether a placement puts the item on a rail. */
export function onRail( placement: NavPlacement ): boolean {
	return 'rail' === placement || 'both' === placement;
}

/** Whether a placement puts the item on the wallpaper. */
export function onDesktop( placement: NavPlacement ): boolean {
	return 'desktop' === placement || 'both' === placement;
}

/**
 * Add or remove one region from a placement, which is every write the
 * context menu and the Preferences rows perform.
 */
export function withRegion(
	current: NavPlacement,
	region: 'rail' | 'desktop',
	on: boolean,
): NavPlacement {
	const rail = 'rail' === region ? on : onRail( current );
	const desktop = 'desktop' === region ? on : onDesktop( current );
	if ( rail && desktop ) {
		return 'both';
	}
	if ( rail ) {
		return 'rail';
	}
	if ( desktop ) {
		return 'desktop';
	}
	return 'hidden';
}
