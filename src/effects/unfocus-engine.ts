/**
 * OpenStation — Unfocused-window effect engine.
 *
 * The framework is a transport, not a UX-policy maker: this engine
 * decides *when* the user's chosen unfocus effect is applied, and to
 * which windows — but the effect itself (the visual) lives in the
 * registered {@link UnfocusEffectDef}. The engine never invents an
 * effect; it only toggles whichever one the user picked in OS Settings
 * → Effects on every window that isn't focused.
 *
 * It listens to the existing window-lifecycle CustomEvents
 * (`os-window-{opened,closed,focused,blurred,reopened}`),
 * the OS-settings change stream (the selected effect id), and the
 * effect-registry change stream (a plugin's effect arriving / leaving
 * live). On any of those it recomputes from scratch — cheap, since
 * there are only ever a handful of open windows.
 */

import {
	getUnfocusEffect,
	listUnfocusEffects,
	subscribeUnfocusEffects,
	UNFOCUS_EFFECT_NONE,
} from './registry';
import type { UnfocusEffectDef } from './types';
import type { OsSettings } from '../settings';
import type { WindowManager } from '../window-manager';

/** Data attribute stamped on a window root carrying the active effect id. */
const EFFECT_ATTR = 'data-desktop-unfocus-effect';

/**
 * Data attribute stamped with the exact CSS class an effect applied.
 * Persisting the class (not just the effect id) means `clear()` can
 * always remove it — even after the effect's def has been unregistered
 * (plugin deactivation), when the registry can no longer tell us which
 * class an id used.
 */
const EFFECT_CLASS_ATTR = 'data-desktop-unfocus-effect-class';

/**
 * Module-level once-guard. The engine wires `document` event listeners
 * that — unlike registry subscribers held in a Set — can't be cheaply
 * deduped or inspected after the fact, so a double `startUnfocusEngine`
 * (HMR, a future refactor, test bleed) would silently double every
 * `recompute`. The engine is only imported by the main shell bundle,
 * so a plain module-level flag is sufficient; `vi.resetModules()`
 * resets it between tests.
 */
let _started = false;

/**
 * True when the window root contains a `<canvas>` in the parent
 * document — i.e. a native WebGL/Pixi scene. Such windows are exempt
 * from unfocus effects: a CSS `filter` over a live WebGL canvas can
 * cause a GPU context loss that crashes the Pixi render loop. Iframe
 * windows hide their content in a separate document, so a canvas there
 * isn't matched (and filtering the iframe element is safe for the
 * non-WebGL admin pages we host).
 */
function hostsCanvas( el: HTMLElement ): boolean {
	return el.querySelector( 'canvas' ) !== null;
}

export interface UnfocusEngineDeps {
	manager: WindowManager;
	osSettings: OsSettings;
}

/**
 * Wire the unfocus-effect engine. Idempotent per shell boot — call
 * once. Returns nothing; the engine self-manages via event listeners
 * that live for the page's lifetime (the shell is torn down only on
 * navigation, which discards the listeners with it).
 */
export function startUnfocusEngine( { manager, osSettings }: UnfocusEngineDeps ): void {
	if ( _started ) {
		return;
	}
	_started = true;

	let currentId = osSettings.getOsSettingsSnapshot().unfocusEffect;

	/**
	 * Strip every effect marker we might have set from a window root.
	 *
	 * @param el         Window root.
	 * @param allEffects Snapshot of registered effects, hoisted out of
	 *                   the per-window loop so the `applyFilters` behind
	 *                   `listUnfocusEffects()` runs once per recompute,
	 *                   not once per window.
	 */
	const clear = ( el: HTMLElement, allEffects: UnfocusEffectDef[] ): void => {
		// Remove the exact class we applied — read from the dedicated
		// attribute so it works even after the effect's def has been
		// unregistered (the registry can no longer map the id → class).
		const storedClass = el.getAttribute( EFFECT_CLASS_ATTR );
		if ( storedClass ) {
			el.classList.remove( storedClass );
			el.removeAttribute( EFFECT_CLASS_ATTR );
		}
		// Run the effect's own teardown if it's still registered.
		const priorId = el.getAttribute( EFFECT_ATTR );
		if ( priorId ) {
			getUnfocusEffect( priorId )?.clear?.( el );
		}
		// Defensive sweep across still-registered effects, in case an
		// effect's class was added by some path that didn't stamp the
		// attribute.
		for ( const def of allEffects ) {
			if ( def.className ) {
				el.classList.remove( def.className );
			}
		}
		el.removeAttribute( EFFECT_ATTR );
	};

	/** Apply the active effect to an unfocused window root. */
	const apply = ( el: HTMLElement, def: UnfocusEffectDef ): void => {
		if ( def.className ) {
			el.classList.add( def.className );
			el.setAttribute( EFFECT_CLASS_ATTR, def.className );
		}
		el.setAttribute( EFFECT_ATTR, def.id );
		def.apply?.( el );
	};

	const recompute = (): void => {
		const def =
			currentId === UNFOCUS_EFFECT_NONE
				? undefined
				: getUnfocusEffect( currentId );
		// One filter call per recompute, shared across every window's
		// clear() sweep below.
		const allEffects = listUnfocusEffects();
		for ( const win of manager.getAll() ) {
			const el = win.element;
			if ( ! el ) {
				continue;
			}
			// Reset first so switching effects (or to "none") never
			// leaves a stale class behind.
			clear( el, allEffects );
			if ( ! def || win.isFocused() || win.state === 'minimized' ) {
				continue;
			}
			// Never paint an unfocus effect over a window that hosts a
			// WebGL `<canvas>` — the native Pixi scenes (content graph,
			// posts mind-map / tag-cloud). A CSS `filter`
			// (or any property that re-rasterizes the subtree) on an
			// element wrapping a live WebGL canvas can trigger a context
			// loss, and the shell's Pixi apps run on their own tickers
			// that then crash on a dead GL context ("null geometry").
			// See the context-loss guard in `content-graph/scene.ts`.
			// Canvases inside iframe windows live in a separate document
			// and aren't reached by this query — that's fine, admin
			// iframes don't run WebGL.
			if ( hostsCanvas( el ) ) {
				continue;
			}
			apply( el, def );
		}
	};

	for ( const name of [
		'os-window-opened',
		'os-window-reopened',
		'os-window-closed',
		'os-window-focused',
		'os-window-blurred',
	] ) {
		document.addEventListener( name, () => recompute() );
	}

	osSettings.subscribeOsSettings( ( snapshot ) => {
		currentId = snapshot.unfocusEffect;
		recompute();
	} );

	subscribeUnfocusEffects( () => recompute() );

	recompute();
}
