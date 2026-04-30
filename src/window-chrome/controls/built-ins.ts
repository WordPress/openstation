/**
 * Built-in window controls — minimize, maximize, fullscreen,
 * detach, reload, close.
 *
 * Each built-in registers as a `WindowControlDef` with a stable
 * `core/*` id, the same icon + label the hardcoded title bar used,
 * and an `onClick` that calls the corresponding `Window` method.
 * Plugins can reorder, hide, or replace any of them through the
 * `WindowControlsConfig` per-window appearance, or globally via
 * `unregisterWindowControl( 'core/close' )`.
 *
 * Built-ins do NOT carry an `owner` — server-sync's owner-bulk
 * teardown skips them, so a plugin deactivating can't accidentally
 * blow away the close button.
 *
 * @since 0.6.0
 */

import { __ } from '../../i18n';
import { registerWindowControl } from './registry';

import type { Window as DesktopWindow } from '../../window';

/**
 * Register the six built-in title-bar controls. Idempotent — calling
 * it twice replaces the entries with identical definitions.
 *
 * Called once by the shell during boot. Plugins should NOT call this;
 * the `core/*` ids are reserved.
 */
export function registerBuiltInControls(): void {
	registerWindowControl( {
		id: 'core/minimize',
		label: __( 'Minimize' ),
		icon: 'minimize',
		placement: 'controls',
		order: 10,
		core: true,
		match: () => true,
		onClick: ( win ) => {
			win.minimize();
		},
	} );

	registerWindowControl( {
		id: 'core/maximize',
		label: __( 'Maximize' ),
		icon: 'maximize',
		placement: 'controls',
		order: 20,
		core: true,
		match: () => true,
		onClick: ( win ) => {
			win.toggleMaximize();
		},
	} );

	registerWindowControl( {
		id: 'core/focus-tab',
		label: __( 'Enter fullscreen' ),
		icon: 'fullscreen',
		placement: 'controls',
		order: 30,
		core: true,
		match: () => true,
		onClick: ( win ) => {
			win.toggleFullscreen();
		},
	} );

	registerWindowControl( {
		id: 'core/detach',
		label: __( 'Detach to new tab' ),
		icon: 'detach',
		placement: 'controls',
		order: 40,
		core: true,
		// Native windows have no admin URL to hand off to a classic tab.
		match: ( win: DesktopWindow ) => ! win.config.native,
		onClick: ( win ) => {
			win.detach();
		},
	} );

	registerWindowControl( {
		id: 'core/reload',
		label: __( 'Reload' ),
		icon: 'reload',
		placement: 'controls',
		order: 45,
		core: true,
		// Native windows own their DOM directly — no iframe to reload.
		match: ( win: DesktopWindow ) => ! win.config.native,
		onClick: ( win ) => {
			win.reload();
		},
	} );

	registerWindowControl( {
		id: 'core/close',
		label: __( 'Close' ),
		icon: 'close',
		placement: 'controls',
		order: 50,
		core: true,
		match: () => true,
		onClick: ( win ) => {
			win.close();
		},
	} );
}
