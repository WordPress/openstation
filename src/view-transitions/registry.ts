/**
 * OpenStation — View-transition registry.
 *
 * Owns the in-memory list of available view transitions and applies the
 * `os.view-transitions` filter each time callers read it, so plugins
 * can register via `wp.os.registerViewTransition()` and also reach the
 * raw filter for reorder / remove / conditional swap.
 *
 * The built-ins are seeded here through the very same `register()` the
 * public hook calls — the shipped transitions dogfood the extensibility
 * API rather than taking a private shortcut. Every one of them is CSS
 * and nothing else: the def below carries an id, a label and a
 * duration, and `assets/css/view-transitions.css` carries the motion,
 * matched up by the view-transition **type** the engine activates. A
 * plugin's transition is built exactly the same way, which is the point.
 *
 * Cross-bundle: the registry AND the subscriber set live in a
 * `createSharedStore` record so the lazy OpenStation-Preferences bundle
 * and the main shell bundle share one registry (see AGENTS.md →
 * "Cross-bundle state"). Without it the panel's selector would iterate
 * its own empty copy and the shell would never hear about transitions
 * the panel registered.
 */

import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { ViewTransitionDef } from './types';

type RegistryListener = () => void;

/**
 * Reserved id meaning "no view transition" — the shell mutates its DOM
 * the way it did before this layer existed, and whatever CSS animation
 * the surface already had (the desktop-area slide, the window-open
 * keyframe) plays instead. Offered in the Preferences selector and used
 * as the engine's sentinel, but never a registered def:
 * `registerViewTransition` rejects it.
 */
export const VIEW_TRANSITION_NONE = 'none';

/** Duration used when a def does not specify one. */
export const DEFAULT_VT_DURATION_MS = 420;

/** Easing used when a def does not specify one. */
export const DEFAULT_VT_EASING = 'cubic-bezier( 0.32, 0.72, 0, 1 )';

/** Shortest transition the engine will play. */
export const MIN_VT_DURATION_MS = 80;

/** Longest transition the engine will play. */
export const MAX_VT_DURATION_MS = 4000;

/**
 * Prefix every view-transition type this layer activates carries.
 *
 * Types share one flat namespace per document, and a document running
 * OpenStation is a `wp-admin` page that any plugin may also be driving
 * transitions on. The prefix keeps a def called `slide` from colliding
 * with some other script's idea of `slide`.
 */
export const VT_TYPE_PREFIX = 'os-vt-';

interface ViewTransitionRegistryStore {
	registry: Map< string, ViewTransitionDef >;
	listeners: Set< RegistryListener >;
}

const store = createSharedStore< ViewTransitionRegistryStore >(
	'desktop-mode/view-transition-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Valid transition id — same charset as the reveal / unfocus-effect /
 * command registries so plugins can namespace `vendor/sub-id`.
 *
 * @internal
 */
const VIEW_TRANSITION_ID = /^[a-z0-9_/-]+$/;

/**
 * The view-transition type name for a def id.
 *
 * Slashes flatten to hyphens because a type is a CSS identifier and
 * `os-vt-acme/warp` is not one. Flattening rather than rejecting keeps
 * the namespacing convention intact across every registry — a plugin
 * author should not have to learn that this one registry spells ids
 * differently.
 *
 * @param id Registered transition id.
 * @return  The `os-vt-…` type to activate for it.
 */
export function viewTransitionTypeFor( id: string ): string {
	return VT_TYPE_PREFIX + id.replace( /\//g, '-' );
}

/**
 * Clamp a def's duration into the playable range. A transition is an
 * accent on a state change: too short and it reads as a flicker, too
 * long and it becomes the thing the user is waiting for instead of the
 * desktop they asked for.
 *
 * @param duration Raw duration from a def, possibly undefined/invalid.
 * @return         A duration in ms, always finite and in range.
 */
export function clampVtDuration( duration: number | undefined ): number {
	if ( typeof duration !== 'number' || ! Number.isFinite( duration ) ) {
		return DEFAULT_VT_DURATION_MS;
	}
	return Math.min(
		MAX_VT_DURATION_MS,
		Math.max( MIN_VT_DURATION_MS, duration ),
	);
}

/**
 * Sentinel for "no global speed override" — every transition plays at
 * whatever its own def asked for. The Preferences default, and what a
 * cleared override falls back to.
 */
export const VT_DURATION_AUTO = 0;

/**
 * Clamp a global speed override. `0` (and anything non-numeric or out
 * of range) means "leave each transition's own timing alone", so a user
 * with no opinion about speed keeps the per-def tuning the built-ins
 * ship with — `cube` needs longer than `crossfade` to read as a
 * rotation rather than a stumble, and flattening both to one number
 * would lose that.
 *
 * @param ms Raw override.
 * @return   A clamped override, or {@link VT_DURATION_AUTO}.
 */
export function clampVtDurationOverride( ms: number ): number {
	if ( typeof ms !== 'number' || ! Number.isFinite( ms ) || ms <= 0 ) {
		return VT_DURATION_AUTO;
	}
	return Math.min(
		MAX_VT_DURATION_MS,
		Math.max( MIN_VT_DURATION_MS, Math.round( ms ) ),
	);
}

function notify(): void {
	listeners.forEach( ( fn ) => fn() );
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 *
 * @param fn Called after every register / unregister.
 * @return   Unsubscribe.
 */
export function subscribeViewTransitions( fn: RegistryListener ): () => void {
	listeners.add( fn );
	return () => {
		listeners.delete( fn );
	};
}

/**
 * Register (or replace) a view transition. Re-registering the same id
 * replaces the previous entry — mirrors WordPress's `register_*`
 * semantics where the latest call wins.
 *
 * Throws a `RegistrationError` on validation failure so plugin authors
 * get a stack frame at registration time instead of a silently missing
 * selector entry.
 *
 * @param  def Transition definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerViewTransition( def: ViewTransitionDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! VIEW_TRANSITION_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ VIEW_TRANSITION_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if ( def.id.trim().toLowerCase() === VIEW_TRANSITION_NONE ) {
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if (
			def.scope !== undefined &&
			def.scope !== 'root' &&
			def.scope !== 'element'
		) {
			errors.push( "scope (must be 'root' or 'element')" );
		}
		if ( def.types !== undefined ) {
			if ( ! Array.isArray( def.types ) ) {
				errors.push( 'types (not an array)' );
			} else if (
				def.types.some(
					( t ) =>
						typeof t !== 'string' ||
						! /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test( t ),
				)
			) {
				// A type is a CSS identifier — anything else silently
				// invalidates the `:active-view-transition-type()`
				// selector that would have matched it, which looks
				// exactly like "my transition does nothing".
				errors.push(
					'types (each entry must be a valid CSS identifier)',
				);
			}
		}
	}

	throwOnRegistrationErrors( 'ViewTransition', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * Remove a transition by id.
 *
 * @param id Registered id.
 */
export function unregisterViewTransition( id: string ): void {
	if ( registry.delete( String( id ).toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every transition registered by a given owner (script handle).
 * Returns the number removed.
 *
 * @param owner Script handle the defs were tagged with.
 * @return      How many were removed.
 */
export function unregisterViewTransitionsByOwner( owner: string ): number {
	let removed = 0;
	for ( const [ id, def ] of registry ) {
		if ( def.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/**
 * Snapshot of the registry with the `os.view-transitions` filter
 * applied. Filtered on every read rather than at registration, so a
 * filter added after boot still takes effect.
 *
 * @return Filtered list, in registration order.
 */
export function listViewTransitions(): ViewTransitionDef[] {
	return applyFilters< ViewTransitionDef[], [] >( HOOKS.VIEW_TRANSITIONS, [
		...registry.values(),
	] );
}

/**
 * Look up a single transition by id, filter applied.
 *
 * @param id Registered id.
 * @return   The def, or `undefined`.
 */
export function getViewTransition( id: string ): ViewTransitionDef | undefined {
	return listViewTransitions().find( ( def ) => def.id === id );
}

/* ------------------------------------------------------------------
 * Built-in transitions.
 *
 * Grouped by what they DO to the two snapshots, because that is what a
 * user is actually choosing between — not by how the CSS achieves it.
 * Durations are tuned per def and deliberately not uniform: a rotation
 * needs more time to read as a rotation than a fade needs to read as a
 * fade.
 *
 * The motion for each lives in `assets/css/view-transitions.css`,
 * matched by `viewTransitionTypeFor( id )`.
 * ------------------------------------------------------------------ */

/* --- Fades ------------------------------------------------------- */

registerViewTransition( {
	id: 'crossfade',
	label: __( 'Crossfade' ),
	description: __(
		'The plain dissolve, on the shell’s own timing. The quiet default.',
	),
	duration: 260,
} );

registerViewTransition( {
	id: 'dissolve',
	label: __( 'Dissolve' ),
	description: __(
		'Softens out of focus as it fades, and sharpens as the new surface arrives.',
	),
	duration: 480,
} );

registerViewTransition( {
	id: 'through-black',
	label: __( 'Through black' ),
	description: __(
		'A film cut — down to black, hold for a beat, back up. Separates two surfaces completely.',
	),
	duration: 620,
} );

/* --- Slides ------------------------------------------------------ */

registerViewTransition( {
	id: 'slide',
	label: __( 'Slide' ),
	description: __(
		'The two surfaces travel together, the way a phone pushes one screen off with the next.',
	),
	duration: 380,
} );

registerViewTransition( {
	id: 'cover',
	label: __( 'Cover' ),
	description: __(
		'The new surface slides in over the old, which stays put underneath.',
	),
	duration: 400,
} );

registerViewTransition( {
	id: 'uncover',
	label: __( 'Uncover' ),
	description: __(
		'The old surface slides away and the new one is simply revealed behind it.',
	),
	duration: 400,
} );

registerViewTransition( {
	id: 'lift',
	label: __( 'Lift' ),
	description: __( 'Vertical push — the new surface rises from below.' ),
	duration: 420,
} );

registerViewTransition( {
	id: 'parallax',
	label: __( 'Parallax' ),
	description: __(
		'Both surfaces slide, the outgoing one at half speed, so it reads as further away.',
	),
	duration: 520,
} );

/* --- Depth ------------------------------------------------------- */

registerViewTransition( {
	id: 'zoom',
	label: __( 'Zoom' ),
	description: __(
		'The old surface falls back into the screen while the new one comes forward.',
	),
	duration: 420,
} );

registerViewTransition( {
	id: 'push-back',
	label: __( 'Push back' ),
	description: __(
		'A deck of cards — the old surface drops back and dims, the new one slides across the front.',
	),
	duration: 520,
} );

registerViewTransition( {
	id: 'warp',
	label: __( 'Warp' ),
	description: __(
		'Hyperspace. The old surface stretches to nothing and the new one snaps back into shape.',
	),
	duration: 560,
} );

/* --- Rotations (share the `os-vt-3d` type for perspective) ------- */

registerViewTransition( {
	id: 'cube',
	label: __( 'Cube' ),
	description: __(
		'The desktop is a face of a cube and the whole thing turns to show the next one.',
	),
	types: [ 'os-vt-3d' ],
	duration: 640,
} );

registerViewTransition( {
	id: 'flip',
	label: __( 'Flip' ),
	description: __( 'The surface flips over like a card to reveal its other side.' ),
	types: [ 'os-vt-3d' ],
	duration: 620,
} );

registerViewTransition( {
	id: 'fold',
	label: __( 'Fold' ),
	description: __(
		'Hinged along the far edge — the old surface swings shut and the new one swings open.',
	),
	types: [ 'os-vt-3d' ],
	duration: 640,
} );

registerViewTransition( {
	id: 'spin',
	label: __( 'Spin' ),
	description: __(
		'A quarter turn in the plane of the screen, shrinking out and growing back in.',
	),
	duration: 560,
} );

/* --- Shaped wipes ------------------------------------------------ */

registerViewTransition( {
	id: 'ripple',
	label: __( 'Ripple' ),
	description: __(
		'The new surface floods out in a circle from wherever you clicked.',
	),
	usesPointer: true,
	duration: 620,
} );

registerViewTransition( {
	id: 'iris',
	label: __( 'Iris' ),
	description: __(
		'A camera aperture — the old surface closes to a point, the new one opens from it.',
	),
	usesPointer: true,
	duration: 660,
} );

registerViewTransition( {
	id: 'wipe',
	label: __( 'Wipe' ),
	description: __( 'A hard edge sweeps across, uncovering the new surface behind it.' ),
	duration: 480,
} );

registerViewTransition( {
	id: 'blinds',
	label: __( 'Blinds' ),
	description: __(
		'Venetian slats — the old surface splits into bands and each one closes.',
	),
	duration: 620,
} );

registerViewTransition( {
	id: 'curtain',
	label: __( 'Curtain' ),
	description: __( 'The old surface parts down the middle and draws aside.' ),
	duration: 560,
} );

registerViewTransition( {
	id: 'shutter',
	label: __( 'Shutter' ),
	description: __(
		'Vertical bands drop away in sequence, left to right, like a shop front opening.',
	),
	duration: 680,
} );

/* --- Station house style ----------------------------------------- */

registerViewTransition( {
	id: 'nebula',
	label: __( 'Nebula' ),
	description: __(
		'The station’s own mesh washes across the screen and carries the new surface in with it.',
	),
	duration: 760,
} );

registerViewTransition( {
	id: 'pulse',
	label: __( 'Pulse' ),
	description: __(
		'A bloom of accent light behind the swap — brief, bright, and gone.',
	),
	usesPointer: true,
	duration: 560,
} );

registerViewTransition( {
	id: 'glitch',
	label: __( 'Glitch' ),
	description: __(
		'A signal drop — the surface tears into offset colour channels and reassembles.',
	),
	duration: 520,
} );

registerViewTransition( {
	id: 'scanline',
	label: __( 'Scanline' ),
	description: __(
		'A CRT refresh: the picture collapses to a line and re-draws from it.',
	),
	duration: 620,
} );

/* ==================================================================
 * WINDOW TRANSITIONS (`scope: 'element'`)
 *
 * A separate family with its own selector, because "how should the
 * screen change" and "how should a window appear" have no overlapping
 * good answers. These play on open, close, minimize, restore, maximize
 * and un-maximize.
 *
 * Every one of them gets the launcher morph for free: on open, the
 * shell pairs the window with whatever the user pressed, so the window
 * grows out of the dock tile or wallpaper icon whichever of these is
 * selected. What the def controls is the character of the arrival — the
 * pairing decides WHERE it comes from, the def decides HOW.
 *
 * They ask for element scope so the transition is confined to the one
 * window's subtree and the rest of the desk keeps painting and keeps
 * accepting input. On engines without element-scoped transitions they
 * still play, just at the root — which is why the motion is written to
 * look deliberate either way.
 * ================================================================== */

registerViewTransition( {
	id: 'morph',
	label: __( 'Morph' ),
	description: __(
		'The purest form — the window is the icon you clicked, grown to size. No motion of its own.',
	),
	scope: 'element',
	duration: 400,
} );

registerViewTransition( {
	id: 'genie',
	label: __( 'Genie' ),
	description: __(
		'The window skews and stretches on the way, the way a lamp takes it.',
	),
	scope: 'element',
	duration: 520,
} );

registerViewTransition( {
	id: 'pop',
	label: __( 'Pop' ),
	description: __(
		'A quick overshoot on the way in, a quick collapse on the way out.',
	),
	scope: 'element',
	duration: 340,
} );

registerViewTransition( {
	id: 'unfold',
	label: __( 'Unfold' ),
	description: __(
		'Hinged at the top — the window swings open from flat, and folds shut again.',
	),
	scope: 'element',
	duration: 480,
} );

registerViewTransition( {
	id: 'swirl',
	label: __( 'Swirl' ),
	description: __( 'Spirals up to size, and spirals back down on the way out.' ),
	scope: 'element',
	duration: 520,
} );

registerViewTransition( {
	id: 'materialize',
	label: __( 'Materialize' ),
	description: __(
		'Arrives out of focus and settles sharp, like something being brought into resolution.',
	),
	scope: 'element',
	duration: 460,
} );

registerViewTransition( {
	id: 'slam',
	label: __( 'Slam' ),
	description: __(
		'Comes in fast and hard from the front, and drops away just as fast.',
	),
	scope: 'element',
	duration: 380,
} );

