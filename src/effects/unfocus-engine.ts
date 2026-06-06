/**
 * Desktop Mode — Unfocused-window effect engine.
 *
 * The framework is a transport, not a UX-policy maker: this engine
 * decides *when* the user's chosen unfocus effect is applied, and to
 * which windows — but the effect itself (the visual) lives in the
 * registered {@link UnfocusEffectDef}. The engine never invents an
 * effect; it only toggles whichever one the user picked in OS Settings
 * → Effects on every window that isn't focused.
 *
 * It listens to the existing window-lifecycle CustomEvents
 * (`desktop-mode-window-{opened,closed,focused,blurred,reopened}`),
 * the OS-settings change stream (the selected effect id), and the
 * effect-registry change stream (a plugin's effect arriving / leaving
 * live). On any of those it recomputes from scratch — cheap, since
 * there are only ever a handful of open windows.
 *
 * @since 0.26.0
 */

import { getUnfocusEffect, listUnfocusEffects, subscribeUnfocusEffects } from './registry';
import type { UnfocusEffectDef } from './types';
import type { OsSettings } from '../settings';
import type { WindowManager } from '../window-manager';

/** The reserved id that means "no effect". Never a registered def. */
const NONE = 'none';

/** Data attribute stamped on a window root carrying the active effect id. */
const EFFECT_ATTR = 'data-desktop-unfocus-effect';

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
	let currentId = osSettings.getOsSettingsSnapshot().unfocusEffect;

	/** Strip every effect marker we might have set from a window root. */
	const clear = ( el: HTMLElement ): void => {
		// Remove the class for whatever effect the element currently
		// carries (read from the data attr) even if that def has since
		// been unregistered, plus defensively sweep all known classes.
		const priorId = el.getAttribute( EFFECT_ATTR );
		if ( priorId ) {
			const prior = getUnfocusEffect( priorId );
			if ( prior?.className ) {
				el.classList.remove( prior.className );
			}
			prior?.clear?.( el );
		}
		for ( const def of listUnfocusEffects() ) {
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
		}
		el.setAttribute( EFFECT_ATTR, def.id );
		def.apply?.( el );
	};

	const recompute = (): void => {
		const def =
			currentId === NONE ? undefined : getUnfocusEffect( currentId );
		for ( const win of manager.getAll() ) {
			const el = win.element;
			if ( ! el ) {
				continue;
			}
			// Reset first so switching effects (or to "none") never
			// leaves a stale class behind.
			clear( el );
			if ( ! def || win.isFocused() || win.state === 'minimized' ) {
				continue;
			}
			apply( el, def );
		}
	};

	for ( const name of [
		'desktop-mode-window-opened',
		'desktop-mode-window-reopened',
		'desktop-mode-window-closed',
		'desktop-mode-window-focused',
		'desktop-mode-window-blurred',
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
