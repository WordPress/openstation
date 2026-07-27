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
	setWindowEffectSelection,
	startStage,
	stopStage,
} from './index';
import {
	genieEffect,
	morphEffect,
	scaleFadeEffect,
} from './window-fx/effects/basic';
import { thanosEffect } from './window-fx/effects/thanos';
import {
	listWindowEffects,
	listWindowEffectsFor,
	registerWindowEffect,
	subscribeWindowEffects,
	unregisterWindowEffect,
	unregisterWindowEffectsByOwner,
} from './window-fx/registry';
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

// Window transition effects, same public path.
registerWindowEffect( scaleFadeEffect );
registerWindowEffect( genieEffect );
registerWindowEffect( morphEffect );
registerWindowEffect( thanosEffect );

const api = {
	start: startStage,
	stop: stopStage,
	setSelection: setStageSelection,
	setWindowEffects: setWindowEffectSelection,
	isActive: isStageActive,
	registerScreenEffect,
	unregisterScreenEffect,
	unregisterScreenEffectsByOwner,
	listScreenEffects,
	subscribeScreenEffects,
	registerWindowEffect,
	unregisterWindowEffect,
	unregisterWindowEffectsByOwner,
	listWindowEffects,
	listWindowEffectsFor,
	subscribeWindowEffects,
};

( window as unknown as { desktopModeStage?: typeof api } ).desktopModeStage =
	api;

export type DesktopModeStageBundle = typeof api;
