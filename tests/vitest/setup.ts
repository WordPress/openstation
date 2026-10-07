if ( typeof window !== 'undefined' && ! window.localStorage ) {
	const store: Record< string, string > = {};
	Object.defineProperty( window, 'localStorage', {
		value: {
			getItem: ( key: string ) => store[ key ] || null,
			setItem: ( key: string, value: string ) => { store[ key ] = String( value ); },
			removeItem: ( key: string ) => { delete store[ key ]; },
			clear: () => { for ( const k of Object.keys( store ) ) { delete store[ k ]; } },
			key: ( index: number ) => Object.keys( store )[ index ] || null,
			get length() { return Object.keys( store ).length; },
		},
		writable: true,
		configurable: true,
	} );
}

import '../../src/ui/components/os-toast/os-toast';
import '../../src/ui/components/os-confirm-dialog/os-confirm-dialog';
import '../../src/ui/components/os-context-menu/os-context-menu';

import '../../src/ui/components/os-button/os-button';
import '../../src/ui/components/os-text-field/os-text-field';

import { Window as DesktopWindow } from '../../src/window';
( window as unknown as {
	openStationWindowSystem?: { createWindow: ( cfg: unknown ) => unknown };
} ).openStationWindowSystem = {
	createWindow: ( cfg: unknown ) =>
		new DesktopWindow( cfg as ConstructorParameters< typeof DesktopWindow >[ 0 ] ),
};
