import type { NavItem, NavPlacement } from '../nav/types';
import type { WorkspaceProfile } from './types';
import { WORKSPACE_APPEARANCE_KEYS } from './types';

export function workspaceMayHide( item: NavItem ): boolean {
	return 'control' !== item.kind && ! item.locked;
}

export function workspacePlacements(
	base: Readonly< Record< string, NavPlacement > >,
	items: readonly NavItem[],
	profile: WorkspaceProfile | null | undefined,
): Record< string, NavPlacement > {
	if ( ! profile || 'only' !== profile.apps.mode ) {
		return base as Record< string, NavPlacement >;
	}
	const keep = new Set( profile.apps.ids );
	const next: Record< string, NavPlacement > = { ...base };
	for ( const item of items ) {
		if ( keep.has( item.id ) || ! workspaceMayHide( item ) ) {
			continue;
		}
		next[ item.id ] = 'hidden';
	}
	return next;
}

export function workspaceWidgetIds(
	profile: WorkspaceProfile | null | undefined,
): string[] | null {
	const widgets = profile?.widgets;
	if ( ! widgets || 'only' !== widgets.mode ) {
		return null;
	}
	return widgets.ids;
}

export function workspaceAppearance(
	profile: WorkspaceProfile | null | undefined,
): Record< string, unknown > | null {
	const raw = profile?.appearance;
	if ( ! raw ) {
		return null;
	}
	const out: Record< string, unknown > = {};
	for ( const key of WORKSPACE_APPEARANCE_KEYS ) {
		if ( undefined !== raw[ key ] ) {
			out[ key ] = raw[ key ];
		}
	}
	return Object.keys( out ).length > 0 ? out : null;
}

export function captureWorkspaceAppearance(
	snapshot: Readonly< Record< string, unknown > >,
): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const key of WORKSPACE_APPEARANCE_KEYS ) {
		if ( undefined !== snapshot[ key ] ) {
			out[ key ] = snapshot[ key ];
		}
	}
	return out;
}

export function withWorkspaceWidget(
	profile: WorkspaceProfile,
	id: string,
	visible: boolean,
): WorkspaceProfile {
	const widgets = profile.widgets;
	if ( ! widgets || 'only' !== widgets.mode ) {
		return profile;
	}
	const has = widgets.ids.includes( id );
	if ( has === visible ) {
		return profile;
	}
	return {
		...profile,
		widgets: {
			mode: 'only',
			ids: visible
				? [ ...widgets.ids, id ]
				: widgets.ids.filter( ( existing ) => existing !== id ),
		},
	};
}

export function withWorkspaceApp(
	profile: WorkspaceProfile,
	id: string,
	visible: boolean,
): WorkspaceProfile {
	if ( 'only' !== profile.apps.mode ) {
		return profile;
	}
	const has = profile.apps.ids.includes( id );
	if ( has === visible ) {
		return profile;
	}
	return {
		...profile,
		apps: {
			mode: 'only',
			ids: visible
				? [ ...profile.apps.ids, id ]
				: profile.apps.ids.filter( ( existing ) => existing !== id ),
		},
	};
}
