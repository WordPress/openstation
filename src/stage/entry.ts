/**
 * Desktop Mode — canvas stage bundle entry.
 *
 * Vite target `stage` → `assets/js/stage[.min].js`. Loaded lazily by
 * `src/stage/loader.ts`, and only when the user has the canvas stage
 * switched on, so a desktop that never enables it pays nothing.
 *
 * Two jobs: seed the built-in screen effects through the same public
 * `registerScreenEffect()` a plugin would call, and publish the bundle
 * API on `window.desktopModeStage`.
 *
 * @since 0.9.8
 */

import { crtEffect } from './effects/crt';
import { pixelArtEffect } from './effects/pixel-art';
import { scanlinesEffect } from './effects/scanlines';
import {
	isStageActive,
	setStageSelection,
	startStage,
	stopStage,
} from './index';
import {
	listScreenEffects,
	registerScreenEffect,
	subscribeScreenEffects,
	unregisterScreenEffect,
	unregisterScreenEffectsByOwner,
} from './registry';

// Built-ins, seeded through the public path so the shipped effects are
// indistinguishable from a plugin's. Registration replaces by id, so a
// double evaluation of this bundle is idempotent.
registerScreenEffect( pixelArtEffect );
registerScreenEffect( scanlinesEffect );
registerScreenEffect( crtEffect );

const api = {
	start: startStage,
	stop: stopStage,
	setSelection: setStageSelection,
	isActive: isStageActive,
	registerScreenEffect,
	unregisterScreenEffect,
	unregisterScreenEffectsByOwner,
	listScreenEffects,
	subscribeScreenEffects,
};

( window as unknown as { desktopModeStage?: typeof api } ).desktopModeStage =
	api;

export type DesktopModeStageBundle = typeof api;
