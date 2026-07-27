/**
 * Desktop Mode — Built-in widgets.
 *
 * Ships one widget on first run: a clock. Universal, demonstrates
 * interval-driven mount/teardown, paints in well under a frame. Any
 * plugin wanting to build against the public widget API has this
 * source as a one-file reference.
 */

import { __ } from '../i18n';
import * as registry from './registry';
import type { WidgetDef } from './types';

const clock: WidgetDef = {
	id: 'clock',
	// Labels/descriptions on built-in defs stay string-literal at
	// module-eval time so the extract-pot pass picks them up. The
	// values are wrapped in `__()` so they translate at runtime.
	get label(): string {
		return __( 'Clock' );
	},
	get description(): string {
		return __( 'Local time and date, refreshed every second.' );
	},
	icon: 'dashicons-clock',
	mount: ( container ) => {
		container.classList.add( 'desktop-mode-widget-clock' );

		const time = document.createElement( 'div' );
		time.className = 'desktop-mode-widget-clock__time';
		container.appendChild( time );

		const date = document.createElement( 'div' );
		date.className = 'desktop-mode-widget-clock__date';
		container.appendChild( date );

		const render = (): void => {
			const now = new Date();
			// Locale-aware formatting so a German user sees 14:05
			// and an American user sees 2:05 PM without extra code.
			time.textContent = now.toLocaleTimeString( undefined, {
				hour: '2-digit',
				minute: '2-digit',
			} );
			date.textContent = now.toLocaleDateString( undefined, {
				weekday: 'long',
				month: 'short',
				day: 'numeric',
			} );
		};
		render();

		// Align the first tick with the wall-clock second boundary
		// so every visible clock onscreen (this widget, the system
		// clock, other tabs) flips in sync. Without the initial
		// delay, our clock would drift up to a second off.
		const msUntilNextSecond = 1000 - ( Date.now() % 1000 );
		let interval: number | null = null;
		const kickoff = window.setTimeout( () => {
			render();
			interval = window.setInterval( render, 1000 );
		}, msUntilNextSecond );

		return () => {
			window.clearTimeout( kickoff );
			if ( interval !== null ) {
				window.clearInterval( interval );
			}
		};
	},
};

/**
 * Register all built-in widgets. Called once during shell boot,
 * BEFORE {@link WidgetLayer#hydrate} so the `clock` default is in
 * the registry when the layer looks it up.
 */
export function registerBuiltInWidgets(): void {
	registry.register( clock );
	// Heartbeat widget moved out of the main bundle.
	// PHP registers it via `desktop_mode_register_widget()`
	// with the `desktop-mode-heartbeat-widget` script handle —
	// the shell's widgets server-sync loads the bundle on
	// demand. See `includes/widgets/heartbeat.php`.
}
