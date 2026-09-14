/** The shared title-bar registry gives every consenting window the same control. */
import { __ } from '../i18n';
import { registerTitleBarButton, unregisterTitleBarButton } from '../title-bar-buttons/registry';
import { MIO_ICON_SVG } from './icon';

let sequence = 0;

export function registerMioWindowToggle(
	windowId: string,
	state: () => { enabled: boolean; available: boolean; thinking: boolean },
	toggle: () => void,
) {
	const id = `openstation/mio-window-${ ++sequence }`;
	const hosts = new Set<HTMLElement>();
	const paint = ( host: HTMLElement ): void => {
		const current = state();
		const on = current.available && current.enabled;
		let label = on ? __( 'Disable MIO in this window' ) : __( 'Enable MIO in this window' );
		if ( ! current.available ) {
			label = __( 'Enable MIO in the dock first' );
		}
		host.setAttribute( 'aria-label', label );
		host.setAttribute( 'title', label );
		host.setAttribute( 'aria-pressed', String( on ) );
		host.toggleAttribute( 'disabled', ! current.available );
		host.inert = ! current.available;
		host.setAttribute( 'aria-hidden', String( ! current.available ) );
		host.dataset.mioAvailable = String( current.available );
		host.toggleAttribute( 'active', on );
		host.dataset.mioDisabled = String( ! on );
		host.dataset.mioThinking = String( on && current.thinking );
	};
	registerTitleBarButton( {
		id, label: __( 'MIO in this window' ), icon: MIO_ICON_SVG.replace( 'id="mio"', `id="mio-${ sequence }"` ).replace( 'url(#mio)', `url(#mio-${ sequence })` ),
		placement: 'right', order: 20,
		match: ( win ) => win.id === windowId,
		render: ( host ) => {
			host.classList.add( 'os-mio-window-toggle' );
			// The dock portrait remains intact; the slash fades across it when off.
			const svg = host.querySelector( 'svg' );
			if ( svg ) {
				const slash = document.createElementNS( 'http://www.w3.org/2000/svg', 'path' );
				slash.setAttribute( 'd', 'M3 3L21 21' );
				slash.setAttribute( 'class', 'os-mio-window-toggle__slash' );
				svg.appendChild( slash );
			}
			hosts.add( host );
			paint( host );
			host.addEventListener( 'os-button-activate', () => {
				if ( state().available ) {
					toggle();
				}
			} );
		},
	} );
	return {
		update: () => {
			for ( const host of hosts ) {
				if ( host.isConnected ) {
					paint( host );
				} else {
					hosts.delete( host );
				}
			}
		},
		dispose: () => {
			unregisterTitleBarButton( id ); hosts.clear();
		},
	};
}
