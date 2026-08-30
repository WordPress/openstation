/**
 * Per-workspace app visibility, as a placement overlay.
 *
 * The navigation already has one answer to "where does this item
 * show?" — {@link import('../nav/types').NavConfig.placement}, the
 * user's stored per-item override — and `computeNav` is a pure
 * function of it. So a workspace does not need a second mechanism: it
 * needs the same map with more `'hidden'` entries in it.
 *
 * That is what this module produces, and it produces it fresh on every
 * repaint rather than writing to the stored preferences. The
 * distinction is the whole design: **a workspace narrows the view, it
 * does not edit the user's settings.** Switching to a Woo desk and back
 * leaves `navPlacement` byte-identical, so a workspace can be deleted
 * without unpicking anything, and the item a user hid globally stays
 * hidden inside every workspace.
 */

import type { NavItem, NavPlacement } from '../nav/types';
import type { WorkspaceProfile } from './types';
import { WORKSPACE_APPEARANCE_KEYS } from './types';

/**
 * Whether a workspace is allowed to hide this item.
 *
 * Two exemptions, and both are structural rather than tuning:
 *
 * - **Controls.** Overview, the System tile (the only route to
 *   Preferences that does not depend on the admin menu), Trash, Mio,
 *   Exit OpenStation. A workspace that could hide these could strand
 *   the user on a desk with no way to change it, and the way out of
 *   that state would be to edit user meta.
 * - **Locked items.** Exit OpenStation already refuses every other
 *   placement write for the same reason; this is that rule, restated
 *   where it would otherwise be bypassed.
 */
export function workspaceMayHide( item: NavItem ): boolean {
	return 'control' !== item.kind && ! item.locked;
}

/**
 * The placement map `computeNav` should run with on this desktop.
 *
 * Returns `base` unchanged — the same object, not a copy — when the
 * workspace narrows nothing. The identity matters: the layout
 * dispatcher recomputes on every window open, close and focus change,
 * and the overwhelmingly common case is a desk that shows everything.
 */
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

/**
 * The widget ids a desk should show, or `null` for "the user's own
 * column".
 *
 * `null` is the answer for a plain Space, for a workspace with no
 * opinion about widgets, and for a profile written before workspaces
 * had them — which is why the field is optional rather than defaulted
 * into the shape. A profile that silently meant "empty column" would
 * blank a user's widgets on upgrade.
 */
export function workspaceWidgetIds(
	profile: WorkspaceProfile | null | undefined,
): string[] | null {
	const widgets = profile?.widgets;
	if ( ! widgets || 'only' !== widgets.mode ) {
		return null;
	}
	return widgets.ids;
}

/**
 * The appearance patch a desk should paint with, keys outside the
 * allowlist dropped.
 *
 * Returns `null` when there is nothing to override — a plain Space, a
 * workspace with no look of its own, or a profile written before
 * workspaces had one. `null` rather than `{}` because the settings
 * layer treats them differently only in intent, and a caller reading
 * "no override" should not have to count keys.
 *
 * The filtering is not defensive tidying: a profile is user meta
 * round-tripped through an untrusted client, and an unfiltered patch
 * spread onto the settings state is a way to write any settings key
 * from anywhere. The server enforces the same list.
 */
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

/**
 * Read a settings snapshot into a workspace appearance patch.
 *
 * "Use the look I have now" — the same gesture as capturing the open
 * windows, and for the same reason: a look is arrived at by trying
 * things in Preferences with the desk in front of you, not by filling
 * in a form. Only the allowlisted keys are taken, so a capture can
 * never smuggle an unrelated setting into a profile.
 */
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

/**
 * Add or remove one widget from a workspace's column.
 *
 * Unlike {@link withWorkspaceApp}, turning one ON while the desk is in
 * `'all'` mode is still a no-op — but for a different reason. There,
 * the visible set does not exist to add to. Here it does not exist
 * *yet*, and flipping the desk into `'only'` on a single toggle would
 * silently adopt whatever the user's column happened to hold as this
 * workspace's permanent answer. The editor makes that switch explicit.
 */
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

/**
 * Add or remove one app from a workspace's visible set.
 *
 * Turning an app ON inside a workspace that shows everything is a
 * no-op by design: there is nothing to add to, and silently flipping
 * the desk into `'only'` mode would hide every app the user did not
 * happen to be looking at.
 */
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
