import {
	ensureShellOverlaysLoaded,
	shellOverlaysBundleUrl,
} from './shell-overlays/loader';
import type { OsConfirmOptions } from './ui/components/os-confirm-dialog/os-confirm-dialog';

export type { OsConfirmOptions };

export async function osConfirm(
	options: OsConfirmOptions,
): Promise< boolean > {
	await ensureShellOverlaysLoaded( shellOverlaysBundleUrl() );
	return new Promise( ( resolve ) => {
		const dialog = document.createElement( 'os-confirm-dialog' );
		dialog.setAttribute( 'open', '' );
		if ( options.title ) {
			dialog.setAttribute( 'title', options.title );
		}
		dialog.setAttribute( 'message', options.message );
		if ( options.confirmLabel ) {
			dialog.setAttribute( 'confirm-label', options.confirmLabel );
		}
		if ( options.cancelLabel ) {
			dialog.setAttribute( 'cancel-label', options.cancelLabel );
		}
		if ( options.danger ) {
			dialog.setAttribute( 'danger', '' );
		}
		if ( options.hideCancel ) {
			dialog.setAttribute( 'hide-cancel', '' );
		}
		if ( options.dismissable ) {
			dialog.setAttribute( 'dismissable', '' );
		}
		if ( options.rememberLabel ) {
			dialog.setAttribute( 'remember-label', options.rememberLabel );
		}
		const cleanup = ( ok: boolean ): void => {
			dialog.remove();
			resolve( ok );
		};
		dialog.addEventListener( 'os-confirm', ( e: Event ) => {
			options.onRemember?.(
				( e as CustomEvent< { remember?: boolean } > ).detail
					?.remember === true,
			);
			cleanup( true );
		} );
		dialog.addEventListener( 'os-cancel', () => cleanup( false ) );
		document.body.appendChild( dialog );
	} );
}
