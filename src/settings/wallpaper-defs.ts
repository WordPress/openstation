/**
 * The two built-in dynamic wallpapers — `custom-gradient` and
 * `custom-image` — whose CSS values are computed from the user's own
 * settings rather than declared once.
 *
 * Registered from the always-on shell bundle (the store calls in on
 * boot and on every apply, so the desktop paints them before any
 * window opens) and re-registered by the Preferences app with the
 * gradient's inline editor attached: "late registrations win" per
 * `wallpapers/registry.ts`, and keeping the editor out of this module
 * is what keeps its `<os-color-field>` / `<os-range-field>` code out
 * of `desktop.min.js`.
 */

import { __ } from '../i18n';
import * as registry from '../wallpapers/registry';
import type { WallpaperEditor } from '../wallpapers/types';
import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from './constants';
import type { OsSettingsState } from './types';

/** Compose the current custom-gradient CSS value from state. */
export function customGradientCss(
	state: Pick< OsSettingsState, 'customGradient' >,
): string {
	const { from, to, angle } = state.customGradient;
	return `linear-gradient(${ angle }deg, ${ from }, ${ to })`;
}

/**
 * Register the custom-gradient wallpaper. Its CSS value is resolved
 * on every apply from the state `read()` returns, so live edits
 * through the editor repaint without re-registering.
 *
 * @param read         The live settings — a getter, because the state
 *                     object is replaced on a rollback and on a reset.
 * @param renderEditor The inline editor, attached by the Preferences
 *                     app only; the shell registers without one.
 */
export function registerCustomGradient(
	read: () => OsSettingsState,
	renderEditor?: WallpaperEditor,
): void {
	registry.register( {
		id: CUSTOM_GRADIENT_ID,
		label: __( 'Custom gradient' ),
		type: 'css',
		preview: customGradientCss( read() ),
		description: __(
			'Mix your own two-colour gradient and set the angle — your desk, your palette.',
		),
		resolveValue: () => customGradientCss( read() ),
		...( renderEditor ? { renderEditor } : {} ),
	} );
}

/**
 * Register, update, or drop the custom-image wallpaper to match
 * `state.customImage`. Idempotent: a def whose value already matches
 * is left alone, so the apply pass can call this every time without
 * waking the registry's subscribers for nothing.
 */
export function registerCustomImageIfPresent( state: OsSettingsState ): void {
	if ( ! state.customImage ) {
		if ( registry.get( CUSTOM_IMAGE_ID ) ) {
			registry.unregister( CUSTOM_IMAGE_ID );
		}
		return;
	}
	const safeUrl = encodeURI( state.customImage.url );
	const value = `url("${ safeUrl }") center/cover no-repeat, #1d2327`;
	const existing = registry.get( CUSTOM_IMAGE_ID );
	if ( existing && existing.type === 'css' && existing.value === value ) {
		return;
	}
	registry.register( {
		id: CUSTOM_IMAGE_ID,
		label: __( 'Custom image' ),
		type: 'css',
		value,
		preview: value,
		description: __(
			'Any image from your media library or an upload, sized to cover the whole desk.',
		),
	} );
}
