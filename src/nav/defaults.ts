import type { NavItem, NavKind, NavLayout, NavPlacement, NavRail, NavZone } from './types';

export const DEFAULT_PLACEMENT: Record< NavKind, NavPlacement > = {
	core: 'rail',
	plugin: 'rail',
	app: 'desktop',
	control: 'rail',
};

export function railFor( kind: NavKind, layout: NavLayout ): NavRail {
	return 'core' === kind && 'classic' === layout ? 'sidebar' : 'dock';
}

export function zoneFor( kind: NavKind ): NavZone {
	if ( 'core' === kind ) {
		return 'core';
	}
	if ( 'control' === kind ) {
		return 'controls';
	}
	return 'apps';
}

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

export function onRail( placement: NavPlacement ): boolean {
	return 'rail' === placement || 'both' === placement;
}

export function onDesktop( placement: NavPlacement ): boolean {
	return 'desktop' === placement || 'both' === placement;
}

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
