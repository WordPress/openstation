/**
 * OpenStation — View transitions, public surface.
 *
 * Re-exports the pieces the shell and the public API need. Import from
 * here rather than reaching into the sub-modules, so the split between
 * registry / player / engine stays an implementation detail.
 */

export type {
	PlayViewTransitionOptions,
	ViewTransitionDef,
	ViewTransitionDirection,
	ViewTransitionResult,
	ViewTransitionScope,
} from './types';

export {
	clampVtDuration,
	clampVtDurationOverride,
	DEFAULT_VT_DURATION_MS,
	DEFAULT_VT_EASING,
	getViewTransition,
	listViewTransitions,
	MAX_VT_DURATION_MS,
	MIN_VT_DURATION_MS,
	registerViewTransition,
	subscribeViewTransitions,
	unregisterViewTransition,
	unregisterViewTransitionsByOwner,
	VIEW_TRANSITION_NONE,
	viewTransitionTypeFor,
	VT_DURATION_AUTO,
	VT_TYPE_PREFIX,
} from './registry';

export {
	getActiveViewTransition,
	getLastPointerElement,
	supportsElementViewTransitions,
	supportsViewTransitions,
	supportsViewTransitionTypes,
	VT_FALLBACK_ATTR,
} from './play';

export { findLaunchSource, isShellBooting } from './launcher';

export {
	getActiveViewTransitionDuration,
	hasActiveViewTransition,
	getActiveViewTransitionId,
	runViewTransition,
	setActiveViewTransitionDuration,
	setActiveViewTransitionId,
	startViewTransitionEngine,
} from './engine';
