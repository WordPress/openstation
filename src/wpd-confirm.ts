/**
 * `wpdConfirm` — main-bundle wrapper around `<wpd-confirm-dialog>`.
 *
 * The component class itself lives in the lazy
 * `shell-overlays[.min].js` bundle (registered there as a side
 * effect — see `src/shell-overlays/entry.ts`). This file holds
 * only the imperative shim: it awaits the bundle load, then
 * constructs the element, sets attributes, listens for
 * `wpd-confirm` / `wpd-cancel`, resolves the promise.
 *
 * The pre-0.8.4 implementation lived inside
 * `src/ui/components/wpd-confirm-dialog/wpd-confirm-dialog.ts`
 * alongside the class. Splitting it out lets Rollup tree-shake
 * the class out of `desktop.min.js` since the only references
 * left in main are this function — which only uses
 * `document.createElement( 'wpd-confirm-dialog' )` and DOM APIs.
 *
 * @since 0.8.4
 */

import {
	ensureShellOverlaysLoaded,
	shellOverlaysBundleUrl,
} from './shell-overlays/loader';
import type { WpdConfirmOptions } from './ui/components/wpd-confirm-dialog/wpd-confirm-dialog';

export type { WpdConfirmOptions };

/**
 * Modal Yes/No replacement for the native `confirm()`. Returns a
 * Promise that resolves to `true` on confirm and `false` on cancel
 * (Escape or the cancel button). Renders the lazy
 * `<wpd-confirm-dialog>` web component.
 */
export async function wpdConfirm(
	options: WpdConfirmOptions,
): Promise< boolean > {
	await ensureShellOverlaysLoaded( shellOverlaysBundleUrl() );
	return new Promise( ( resolve ) => {
		const dialog = document.createElement( 'wpd-confirm-dialog' );
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
		dialog.addEventListener( 'wpd-confirm', () => cleanup( true ) );
		dialog.addEventListener( 'wpd-cancel', () => cleanup( false ) );
		document.body.appendChild( dialog );
		const inner = dialog.shadowRoot?.querySelector< HTMLElement >( '.dialog' );
		( inner ?? dialog ).focus?.();
	} );
}
