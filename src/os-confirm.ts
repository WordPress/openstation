/**
 * `osConfirm` — main-bundle wrapper around `<os-confirm-dialog>`.
 *
 * The component class itself lives in the lazy
 * `shell-overlays[.min].js` bundle (registered there as a side
 * effect — see `src/shell-overlays/entry.ts`). This file holds
 * only the imperative shim: it awaits the bundle load, then
 * constructs the element, sets attributes, listens for
 * `os-confirm` / `os-cancel`, resolves the promise.
 *
 * The implementation previously lived inside
 * `src/ui/components/os-confirm-dialog/os-confirm-dialog.ts`
 * alongside the class. Splitting it out lets Rollup tree-shake
 * the class out of `desktop.min.js` since the only references
 * left in main are this function — which only uses
 * `document.createElement( 'os-confirm-dialog' )` and DOM APIs.
 */

import {
	ensureShellOverlaysLoaded,
	shellOverlaysBundleUrl,
} from './shell-overlays/loader';
import type { OsConfirmOptions } from './ui/components/os-confirm-dialog/os-confirm-dialog';

export type { OsConfirmOptions };

/**
 * Modal Yes/No replacement for the native `confirm()`. Returns a
 * Promise that resolves to `true` on confirm and `false` on cancel
 * (Escape or the cancel button). Renders the lazy
 * `<os-confirm-dialog>` web component.
 */
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
		const cleanup = ( ok: boolean ): void => {
			dialog.remove();
			resolve( ok );
		};
		dialog.addEventListener( 'os-confirm', () => cleanup( true ) );
		dialog.addEventListener( 'os-cancel', () => cleanup( false ) );
		document.body.appendChild( dialog );
		const inner = dialog.shadowRoot?.querySelector< HTMLElement >( '.dialog' );
		( inner ?? dialog ).focus?.();
	} );
}
