/**
 * OpenStation — Window-reveal registry.
 *
 * Owns the in-memory list of available window reveals and applies the
 * `os.window-reveals` filter each time callers read it, so
 * plugins can register via `wp.os.registerWindowReveal()` and also
 * reach the raw filter for reorder / remove / conditional swap.
 *
 * The built-ins are seeded here through the very same `register()`
 * the public hook calls — the shipped reveals dogfood the extensibility
 * API rather than taking a private shortcut.
 *
 * Cross-bundle: the registry AND the subscriber set live in a
 * `createSharedStore` record so the lazy OS-Settings-panel bundle and
 * the main shell bundle share one registry (see AGENTS.md →
 * "Cross-bundle state"). Without it the panel's selector would iterate
 * its own empty copy and the shell would never hear about reveals the
 * panel registered.
 */

import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import {
	blindsPair,
	curtainPair,
	diagonalPair,
	diamondPair,
	irisPair,
	mosaicPair,
	radarPair,
	risePair,
	shutterPair,
	slatsPair,
	sweepPair,
} from './shapes';
import { renderObturator } from './obturator';
import type { WindowRevealDef, WindowRevealLayer } from './types';

type RegistryListener = () => void;

/**
 * Reserved reveal id meaning "no reveal" — the content simply fades in
 * the way it did before reveals existed. Offered in the OS Settings
 * selector and used as the engine's sentinel, but never a registered
 * def: `registerWindowReveal` rejects it.
 */
export const WINDOW_REVEAL_NONE = 'none';

/** Duration used when a def does not specify one. */
export const DEFAULT_REVEAL_DURATION_MS = 460;

/** Easing used when a def does not specify one. */
export const DEFAULT_REVEAL_EASING = 'cubic-bezier( 0.33, 0, 0.2, 1 )';

/** Shortest reveal the engine will play. See {@link clampRevealDuration}. */
export const MIN_REVEAL_DURATION_MS = 80;

/** Longest reveal the engine will play. See {@link clampRevealDuration}. */
export const MAX_REVEAL_DURATION_MS = 4000;

/**
 * How far the leading edge trails the surface when a def does not say.
 * Chosen relative to the default duration rather than in absolute
 * terms: at ~15% of the run the band is wide enough to read as a
 * deliberate edge and narrow enough not to look like a second surface.
 */
export const DEFAULT_REVEAL_EDGE_LAG_MS = 70;

/**
 * Longest edge lag the engine will play. Past this the edge stops
 * reading as an edge and becomes a second reveal chasing the first.
 */
export const MAX_REVEAL_EDGE_LAG_MS = 600;

interface WindowRevealRegistryStore {
	registry: Map< string, WindowRevealDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WindowRevealRegistryStore >(
	'desktop-mode/window-reveal-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Valid reveal id — same charset as the unfocus-effect / command
 * registries so plugins can namespace `vendor/sub-id`.
 *
 * @internal
 */
const WINDOW_REVEAL_ID = /^[a-z0-9_/-]+$/;

/**
 * Leading shape function of a `clip-path` value (`inset`, `circle`,
 * `polygon`, …). Used to reject non-interpolable `from` / `to` pairs at
 * registration time.
 *
 * @internal
 */
function shapeFunction( value: string ): string {
	const match = /^\s*([a-zA-Z-]+)\s*\(/.exec( value );
	return match ? match[ 1 ].toLowerCase() : '';
}

/**
 * Clamp a def's duration into the playable range. A reveal is an accent
 * on a page load: too short and it reads as a flicker, too long and it
 * becomes the thing the user is waiting for instead of the page.
 *
 * @param duration Raw duration from a def, possibly undefined/invalid.
 * @return A duration in ms, always finite and in range.
 */
export function clampRevealDuration( duration: number | undefined ): number {
	if ( typeof duration !== 'number' || ! Number.isFinite( duration ) ) {
		return DEFAULT_REVEAL_DURATION_MS;
	}
	return Math.min(
		MAX_REVEAL_DURATION_MS,
		Math.max( MIN_REVEAL_DURATION_MS, duration ),
	);
}

/**
 * Sentinel for "no global duration override" — every reveal plays at
 * whatever its own def asked for. The OS Settings default, and what a
 * cleared override falls back to.
 */
export const REVEAL_DURATION_AUTO = 0;

/**
 * Clamp a global duration override. Unlike {@link clampRevealDuration}
 * this has a real "unset" value: `0` (and anything non-numeric) means
 * "leave each reveal's own timing alone", so a user who never touched
 * the setting keeps the per-reveal tuning the built-ins ship with —
 * Radar's full turn is deliberately slower than Sweep's straight line,
 * and flattening both to one number would lose that.
 *
 * @param value Raw override, from OS Settings or a theme token.
 * @return A duration in ms, or {@link REVEAL_DURATION_AUTO}.
 */
export function clampRevealDurationOverride( value: number | undefined ): number {
	if ( typeof value !== 'number' || ! Number.isFinite( value ) || value <= 0 ) {
		return REVEAL_DURATION_AUTO;
	}
	return Math.min(
		MAX_REVEAL_DURATION_MS,
		Math.max( MIN_REVEAL_DURATION_MS, value ),
	);
}

/**
 * Clamp a def's edge lag into the playable range. `0` is a real value
 * — it means "no leading edge" — so unlike the duration this floors at
 * zero rather than at a minimum.
 *
 * @param lag Raw lag from a def, possibly undefined/invalid.
 * @return A lag in ms, always finite and in range.
 */
export function clampRevealEdgeLag( lag: number | undefined ): number {
	if ( typeof lag !== 'number' || ! Number.isFinite( lag ) ) {
		return DEFAULT_REVEAL_EDGE_LAG_MS;
	}
	return Math.min( MAX_REVEAL_EDGE_LAG_MS, Math.max( 0, lag ) );
}

/**
 * A def's animated layers, normalized. A single-layer def (the common
 * case) yields one entry built from its own `from` / `to`; a
 * multi-layer def yields its `layers` verbatim.
 *
 * Every consumer works in terms of this list, so nothing downstream
 * needs to know which form a def was written in.
 *
 * @param def A registered reveal.
 * @return One matched pair per layer. Empty only for a malformed def.
 */
export function revealLayerPairs( def: WindowRevealDef ): WindowRevealLayer[] {
	if ( typeof def.render === 'function' ) {
		// A custom renderer owns its own DOM; there are no clip-path
		// pairs to normalize.
		return [];
	}
	if ( Array.isArray( def.layers ) && def.layers.length > 0 ) {
		return def.layers;
	}
	if ( typeof def.from === 'string' && typeof def.to === 'string' ) {
		return [ { from: def.from, to: def.to } ];
	}
	return [];
}

/**
 * Validate one matched pair, returning the reasons it cannot be
 * animated. See the interpolation contract in `./types`.
 *
 * @internal
 */
function pairErrors( pair: Partial< WindowRevealLayer >, label: string ): string[] {
	const errors: string[] = [];
	const fromOk = typeof pair.from === 'string' && pair.from.trim() !== '';
	const toOk = typeof pair.to === 'string' && pair.to.trim() !== '';
	if ( ! fromOk ) {
		errors.push( `${ label }.from (missing — the clip-path covering the window)` );
	}
	if ( ! toOk ) {
		errors.push( `${ label }.to (missing — the clip-path uncovering the window)` );
	}
	if ( fromOk && toOk ) {
		const a = shapeFunction( pair.from as string );
		const b = shapeFunction( pair.to as string );
		if ( a === '' || b === '' ) {
			errors.push(
				`${ label }.from|to (must be shape functions, e.g. \`inset( … )\` or \`polygon( … )\` — bare keywords like \`none\` cannot be animated)`,
			);
		} else if ( a !== b ) {
			errors.push(
				`${ label }.from|to (must use the same shape function to interpolate — got \`${ a }()\` and \`${ b }()\`)`,
			);
		}
	}
	return errors;
}

/**
 * Whether the browser can parse `easing`. `Element.animate()` throws a
 * `TypeError` on an easing it cannot parse — and it would do so at PLAY
 * time, with the opaque armed surface already covering the window, so
 * the string has to be rejected here at registration instead. A
 * throwaway `KeyframeEffect` runs the same parser `animate()` uses.
 * Environments without the Web Animations API (jsdom, reduced-motion
 * fallback paths) accept everything: they never call `animate()`.
 */
function isParseableEasing( easing: string ): boolean {
	if ( typeof KeyframeEffect !== 'function' ) {
		return true;
	}
	try {
		void new KeyframeEffect( null, null, { easing } );
		return true;
	} catch {
		return false;
	}
}

/**
 * Register (or replace) a window reveal. Re-registering the same id
 * replaces the previous entry — mirrors WordPress's `register_*`
 * semantics where the latest call wins.
 *
 * Throws a {@link RegistrationError} on validation failure so plugin
 * authors get a stack frame at registration time instead of a silently
 * missing selector entry — or, worse, a reveal that registers fine and
 * then flickers at runtime because its two endpoints cannot interpolate.
 *
 * @param  def Reveal definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerWindowReveal( def: WindowRevealDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_REVEAL_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_REVEAL_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if ( def.id.trim().toLowerCase() === WINDOW_REVEAL_NONE ) {
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		const hasRender = def.render !== undefined;
		const hasLayers = Array.isArray( def.layers );
		const hasPair = def.from !== undefined || def.to !== undefined;
		if ( hasRender && typeof def.render !== 'function' ) {
			errors.push( 'render (not a function)' );
		} else if ( hasRender && ( hasLayers || hasPair ) ) {
			errors.push(
				'render|layers|from|to (supply exactly one of: a from/to pair, a layers array, or a render function)',
			);
		} else if ( hasRender ) {
			// A renderer owns its DOM outright — nothing else to check.
		} else if ( hasLayers && hasPair ) {
			errors.push(
				'layers|from|to (supply EITHER a single from/to pair OR a layers array, not both)',
			);
		} else if ( hasLayers ) {
			if ( def.layers!.length === 0 ) {
				errors.push( 'layers (empty — supply at least one matched pair)' );
			}
			def.layers!.forEach( ( layer, i ) => {
				if ( ! layer || typeof layer !== 'object' ) {
					errors.push( `layers[ ${ i } ] (not an object)` );
					return;
				}
				errors.push( ...pairErrors( layer, `layers[ ${ i } ]` ) );
			} );
		} else {
			// Single-layer form. Report against the bare field names, so
			// the overwhelmingly common case reads as it always has.
			errors.push(
				...pairErrors( def, '' ).map( ( e ) => e.replace( /^\./, '' ) ),
			);
		}
		if ( def.easing !== undefined ) {
			if ( typeof def.easing !== 'string' || def.easing.trim() === '' ) {
				errors.push( 'easing (not a non-empty string)' );
			} else if ( ! isParseableEasing( def.easing ) ) {
				errors.push(
					'easing (not an easing the browser can parse — `Element.animate()` would throw at play time, with the covering surface already over the window)',
				);
			}
		}
	}

	throwOnRegistrationErrors( 'WindowReveal', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/** Remove a reveal by id. */
export function unregisterWindowReveal( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every reveal registered by a given owner (script handle).
 * Returns the number removed.
 *
 * This is the grouped-eviction primitive for a live-unregister sweep on
 * plugin deactivation — but reveals have no PHP script-registration
 * companion yet (same known gap as palettes), so nothing calls it on
 * the deactivation path today. Defs that set `owner` now start being
 * swept the moment that sweep lands, with no def change.
 */
export function unregisterWindowRevealsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
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
 * Current reveal list with the `os.window-reveals` filter
 * applied. The values are copied so a filter callback can mutate its
 * input safely; a misbehaving filter that returns a non-array falls
 * back to the unfiltered list.
 */
export function listWindowReveals(): WindowRevealDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< WindowRevealDef[] >(
		HOOKS.WINDOW_REVEALS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.window-reveals` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

/** Look up a reveal by id, post-filter. */
export function getWindowReveal( id: string ): WindowRevealDef | undefined {
	return listWindowReveals().find( ( r ) => r.id === id );
}

/**
 * Whether anything is registered under this id — a raw map lookup, no
 * filter and therefore no `wp.hooks` dependency.
 *
 * Exists so leaf modules can ask the registration question without
 * pulling the hook bus in behind them (`desktop-themes/recommended.ts`
 * is the caller, and it is a leaf of the always-on shell bundle). It
 * mirrors what the dock-rail registry's `get()` does for the same
 * check on the same code path.
 *
 * Use {@link getWindowReveal} anywhere the filtered view is the right
 * answer — anything user-facing.
 */
export function hasWindowReveal( id: string ): boolean {
	return registry.has( id );
}

/**
 * Subscribe to registry changes — the OS Settings selector repaints
 * when this fires. Returns an unsubscribe.
 */
export function subscribeWindowReveals( cb: RegistryListener ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] window-reveal registry listener threw:',
					err,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Built-in reveals
//
// Seeded through the public `register()` path so the shipped reveals are
// indistinguishable from a plugin's. `register()` replaces by id, so a
// re-import (the panel bundle also evaluates this module) is idempotent.
// ---------------------------------------------------------------------------
registerWindowReveal( {
	id: 'sweep',
	label: __( 'Sweep' ),
	description: __(
		'A straight edge travels across the window, uncovering the page behind it.',
	),
	...sweepPair(),
	duration: 420,
} );

registerWindowReveal( {
	id: 'iris',
	label: __( 'Iris' ),
	description: __(
		'The page opens out from the centre of the window, like a camera shutter.',
	),
	...irisPair(),
	duration: 520,
} );

registerWindowReveal( {
	id: 'curtain',
	label: __( 'Curtain' ),
	description: __(
		'Two panels part from the middle of the window and slide off the sides.',
	),
	...curtainPair(),
	duration: 480,
} );

registerWindowReveal( {
	id: 'blinds',
	label: __( 'Blinds' ),
	description: __(
		'Six horizontal slats retract at once, letting the page through between them.',
	),
	...blindsPair(),
	duration: 560,
} );

registerWindowReveal( {
	id: 'diagonal',
	label: __( 'Diagonal' ),
	description: __(
		'A slanted edge sweeps off the trailing corner of the window.',
	),
	...diagonalPair(),
	duration: 460,
} );

registerWindowReveal( {
	id: 'rise',
	label: __( 'Rise' ),
	description: __(
		'The page rises into the window from the bottom edge upward.',
	),
	...risePair(),
	duration: 440,
} );

registerWindowReveal( {
	id: 'shutter',
	label: __( 'Shutter' ),
	description: __(
		'Two panels part from the middle of the window and slide off the top and bottom.',
	),
	...shutterPair(),
	duration: 480,
} );

registerWindowReveal( {
	id: 'slats',
	label: __( 'Slats' ),
	description: __(
		'Eight vertical slats retract at once, letting the page through between them.',
	),
	...slatsPair(),
	duration: 560,
} );

registerWindowReveal( {
	id: 'diamond',
	label: __( 'Diamond' ),
	description: __(
		'The page opens out from the centre of the window through a growing rhombus.',
	),
	...diamondPair(),
	duration: 520,
} );

registerWindowReveal( {
	id: 'mosaic',
	label: __( 'Mosaic' ),
	description: __(
		'The page arrives as a grid of tiles, each opening out from its own centre.',
	),
	...mosaicPair(),
	duration: 600,
} );

registerWindowReveal( {
	id: 'obturator',
	label: __( 'Camera shutter' ),
	description: __(
		'Six wedges slide aside in unison, opening a hexagonal aperture from the centre like the iris of a camera lens.',
	),
	// Rendered rather than described as clip-path layers. A lens iris
	// has a CYCLIC overlap — every leaf over the next, the last back
	// under the first — and paint order is linear, so no stack of
	// layers can represent it. As SVG the wedges are paths under one
	// mask, each sliding tangentially, and the cycle stops mattering.
	// See `src/reveals/obturator.ts`.
	render: renderObturator,
	duration: 720,
	// A rendered reveal is a single element: the shell's trailing-edge
	// layer never applies to it, and the leaves' own outlines do that
	// job far better anyway. See `src/reveals/obturator.ts`.
	edgeLag: 0,
} );

registerWindowReveal( {
	id: 'radar',
	label: __( 'Radar' ),
	description: __(
		'A spoke sweeps a full turn around the centre of the window, uncovering the page behind it.',
	),
	...radarPair(),
	duration: 760,
} );
