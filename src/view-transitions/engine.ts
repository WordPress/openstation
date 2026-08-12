/**
 * OpenStation — View-transition engine.
 *
 * Holds the user's currently-selected transition and keeps it in sync
 * with OpenStation Preferences, and exposes the one call every surface
 * uses: {@link runViewTransition}.
 *
 * Deliberately thin, for the same reason the reveal engine is: there is
 * no "which windows does this apply to" question to answer. A view
 * transition is triggered by a specific state change and the code
 * making that change already owns the trigger. So this module answers
 * one question — "which transition is active right now?" — and hands
 * the rest to the player.
 *
 * Cross-bundle: the selection lives in a `createSharedStore` record.
 * The Preferences-panel bundle writes the user's pick through the
 * settings save path, and the shell bundle reads it when a desktop
 * switches; module-level state would give each bundle its own copy and
 * the shell would keep playing whatever was selected at boot (see
 * AGENTS.md → "Cross-bundle state").
 */

import { createSharedStore } from '../shared-store';
import { playViewTransition, trackViewTransitionOrigin } from './play';
import {
	clampVtDurationOverride,
	getViewTransition,
	VIEW_TRANSITION_NONE,
	VT_DURATION_AUTO,
} from './registry';
import type {
	PlayViewTransitionOptions,
	ViewTransitionResult,
	ViewTransitionScope,
} from './types';
import type { OsSettings } from '../settings';

/**
 * The two selections, one per scope.
 *
 * There are two settings rather than one because there are two
 * genuinely different questions, and a single answer to both is wrong
 * either way round. "How should the screen change when I switch Space?"
 * and "how should a window appear when I open it?" have no overlapping
 * good answers: a cube rotation is right for the first and absurd for
 * the second (it would freeze and rotate the whole desk to animate one
 * corner), while a window growing out of the icon you clicked is right
 * for the second and meaningless for the first.
 *
 * The registry is partitioned by the same `scope` field, so each
 * selector offers only the transitions that make sense for it and the
 * player refuses a mismatched pairing.
 */
interface ActiveViewTransitionStore {
	/** Whole-screen changes: desktop switch, overview, appearance. */
	root: string;
	/** One window: open, close, minimize, restore, maximize. */
	element: string;
	/** Shared speed override — one "how fast is this desktop" knob. */
	duration: number;
}

const store = createSharedStore< ActiveViewTransitionStore >(
	'desktop-mode/view-transition-active',
	() => ( {
		root: VIEW_TRANSITION_NONE,
		element: VIEW_TRANSITION_NONE,
		duration: VT_DURATION_AUTO,
	} ),
);

/**
 * Set the active transition id for a scope. Any string is accepted —
 * resolution happens at play time, so a transition whose plugin has not
 * loaded yet can be selected now and start working the moment it
 * registers.
 *
 * @param scope Which family the id belongs to.
 * @param id    Transition id, or `'none'`.
 */
export function setActiveViewTransitionId(
	scope: ViewTransitionScope,
	id: string,
): void {
	store.state[ scope ] =
		typeof id === 'string' && id !== '' ? id : VIEW_TRANSITION_NONE;
}

/**
 * The active transition id for a scope, resolved or not.
 *
 * @param scope Which family to read.
 * @return      The selected id.
 */
export function getActiveViewTransitionId(
	scope: ViewTransitionScope = 'root',
): string {
	return store.state[ scope ];
}

/**
 * Set the user's global speed override, in ms.
 * {@link VT_DURATION_AUTO} (`0`) restores each transition's own timing.
 *
 * @param ms Override duration, or `0`.
 */
export function setActiveViewTransitionDuration( ms: number ): void {
	store.state.duration = clampVtDurationOverride( ms );
}

/** The user's global speed override, or {@link VT_DURATION_AUTO}. */
export function getActiveViewTransitionDuration(): number {
	return store.state.duration;
}

/**
 * Play a transition around a DOM mutation, using the user's current
 * selection unless the caller names one.
 *
 * This is the entry point every shell surface should call instead of
 * mutating and hoping. It always runs the update exactly once.
 *
 * @param opts What to change, and how it should look.
 * @return     Whether it animated.
 */
export function runViewTransition(
	opts: PlayViewTransitionOptions,
): Promise< ViewTransitionResult > {
	const scope = opts.family ?? 'root';
	return playViewTransition(
		opts,
		store.state[ scope ],
		store.state.duration,
	);
}

/**
 * Whether the user has a usable selection for a given scope — the
 * cheap check a surface makes BEFORE restructuring its own code path.
 *
 * Every wired surface follows the same shape: if this returns `false`,
 * take the original un-animated path untouched; if `true`, run the same
 * mutation inside a transition. Keeping the old path literally
 * unchanged rather than "the animated path with a zero duration" is
 * what makes the whole layer safe to have added — every existing
 * behaviour still has an execution path that never touches this module.
 *
 * @param scope The kind of change the caller is about to make.
 * @return      `true` when a transition should be played for it.
 */
export function hasActiveViewTransition(
	scope: ViewTransitionScope,
): boolean {
	const id = store.state[ scope ];
	if ( ! id || id === VIEW_TRANSITION_NONE ) {
		return false;
	}
	const def = getViewTransition( id );
	if ( ! def ) {
		return false;
	}
	// A def whose scope disagrees with the selector it was chosen from
	// (a plugin re-registering an id under a different scope while it is
	// selected) is treated as absent rather than played in the wrong
	// place.
	return ( def.scope ?? 'root' ) === scope;
}

export interface ViewTransitionEngineDeps {
	osSettings: OsSettings;
}

/**
 * Wire the transition selection to OpenStation Preferences, and start
 * recording pointer origins for the shaped transitions. Call once from
 * shell boot.
 *
 * Idempotent in effect rather than by latch: it seeds the current value
 * and adds a subscriber, and re-running would only re-seed the same
 * value plus a duplicate subscriber that writes the identical id.
 *
 * @param deps            Shell dependencies.
 * @param deps.osSettings OpenStation Preferences store.
 */
export function startViewTransitionEngine( {
	osSettings,
}: ViewTransitionEngineDeps ): void {
	trackViewTransitionOrigin();
	const apply = ( snapshot: {
		viewTransition: string;
		windowTransition: string;
		viewTransitionDuration: number;
	} ): void => {
		setActiveViewTransitionId( 'root', snapshot.viewTransition );
		setActiveViewTransitionId( 'element', snapshot.windowTransition );
		setActiveViewTransitionDuration( snapshot.viewTransitionDuration );
	};
	apply( osSettings.getOsSettingsSnapshot() );
	osSettings.subscribeOsSettings( apply );
}
