/**
 * OpenStation — Window-reveal engine.
 *
 * Holds the user's currently-selected reveal and keeps it in sync with
 * OS Settings. Deliberately thin: unlike the unfocus engine, which has
 * to decide *which windows* an effect applies to on every focus change,
 * a reveal is triggered by exactly one event — a window's content
 * finishing its load — and that trigger already has an owner in
 * `src/window/loading.ts`. Putting a second subscriber on the same hook
 * would race it for the order in which classes land on the body.
 *
 * So this module answers one question — "which reveal is active right
 * now?" — and `loading.ts` calls the surface helpers at the two edges it
 * already owns.
 *
 * Cross-bundle: the selected id lives in a `createSharedStore` record.
 * The OS-Settings-panel bundle writes the user's pick through the
 * settings save path, and the shell bundle reads it when a window
 * loads; module-level state would give each bundle its own copy and the
 * shell would keep playing whatever was selected at boot (see AGENTS.md
 * → "Cross-bundle state").
 */

import { createSharedStore } from '../shared-store';
import {
	clampRevealDurationOverride,
	getWindowReveal,
	REVEAL_DURATION_AUTO,
	WINDOW_REVEAL_NONE,
} from './registry';
import type { WindowRevealDef } from './types';
import type { OsSettings } from '../settings';

interface ActiveRevealStore {
	id: string;
	duration: number;
}

const store = createSharedStore< ActiveRevealStore >(
	'desktop-mode/window-reveal-active',
	() => ( { id: WINDOW_REVEAL_NONE, duration: REVEAL_DURATION_AUTO } ),
);

/**
 * Set the active reveal id. Any string is accepted — resolution
 * happens at play time, so a reveal whose plugin has not loaded yet can
 * be selected now and start working the moment it registers.
 *
 * @param id Reveal id, or `'none'`.
 */
export function setActiveWindowRevealId( id: string ): void {
	store.state.id = typeof id === 'string' && id !== '' ? id : WINDOW_REVEAL_NONE;
}

/** The active reveal id, resolved or not. */
export function getActiveWindowRevealId(): string {
	return store.state.id;
}

/**
 * The active reveal def, or `null` when the user picked `'none'` — or
 * when the selected id has no matching registration (an uninstalled
 * plugin's reveal still named in user meta). An unknown id degrades to
 * "no reveal" rather than to a built-in: silently substituting a
 * different animation would be a stranger outcome than none at all.
 */
export function getActiveWindowReveal(): WindowRevealDef | null {
	const id = store.state.id;
	if ( ! id || id === WINDOW_REVEAL_NONE ) {
		return null;
	}
	return getWindowReveal( id ) ?? null;
}

/**
 * Set the user's global duration override, in ms.
 * {@link REVEAL_DURATION_AUTO} (`0`) restores each reveal's own timing.
 *
 * @param ms Override duration, or `0` for per-reveal timing.
 */
export function setActiveWindowRevealDuration( ms: number ): void {
	store.state.duration = clampRevealDurationOverride( ms );
}

/**
 * The user's global duration override, or {@link REVEAL_DURATION_AUTO}
 * when they have not set one. The surface consults this BEFORE the
 * `--os-window-reveal-duration` theme token: an explicit
 * choice in OS Settings is the user speaking, and a theme should not
 * out-rank it — the same precedence window corner radius uses.
 */
export function getActiveWindowRevealDuration(): number {
	return store.state.duration;
}

export interface WindowRevealEngineDeps {
	osSettings: OsSettings;
}

/**
 * Wire the reveal selection to OS Settings. Call once from shell boot.
 *
 * Idempotent in effect rather than by latch: it seeds the current value
 * and adds a subscriber, and re-running would only re-seed the same
 * value plus a duplicate subscriber that writes the identical id.
 */
export function startWindowRevealEngine( {
	osSettings,
}: WindowRevealEngineDeps ): void {
	const seed = osSettings.getOsSettingsSnapshot();
	setActiveWindowRevealId( seed.windowReveal );
	setActiveWindowRevealDuration( seed.windowRevealDuration );
	osSettings.subscribeOsSettings( ( snapshot ) => {
		setActiveWindowRevealId( snapshot.windowReveal );
		setActiveWindowRevealDuration( snapshot.windowRevealDuration );
	} );
}
