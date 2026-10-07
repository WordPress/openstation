import { __ } from '../i18n';
import * as registry from './registry';
import type { WidgetDef } from './types';

const clock: WidgetDef = {
	id: 'clock',

	get label(): string {
		return __( 'Clock' );
	},
	get description(): string {
		return __( 'Local time and date, refreshed every second.' );
	},
	icon: 'dashicons-clock',
	mount: ( container ) => {
		container.classList.add( 'os-widget-clock' );

		const time = document.createElement( 'div' );
		time.className = 'os-widget-clock__time';
		container.appendChild( time );

		const date = document.createElement( 'div' );
		date.className = 'os-widget-clock__date';
		container.appendChild( date );

		const render = (): void => {
			const now = new Date();

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

export function registerBuiltInWidgets(): void {
	registry.register( clock );
}
