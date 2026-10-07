import { __ } from '../../i18n';
import { registerWindowControl } from './registry';

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
