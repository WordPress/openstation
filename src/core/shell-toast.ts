/**
 * The shell's toast, from any bundle.
 *
 * `showToast()` in `src/toast.ts` is the implementation, and the shell
 * publishes it as `wp.os.showToast` at boot. A lazy or feature bundle
 * (notes, the Drafts widget, the agents window, an app's client view)
 * must not import the module — that would pull the activity bus and the
 * overlay loader into its own copy — so it reaches the published one
 * through this accessor instead of each declaring its own lookup and
 * its own copy of the options shape.
 *
 * A no-op with a no-op dismiss when the shell is not there (a bundle
 * loaded outside the shell, a test without the global).
 */

import type { ToastOptions } from '../toast';

export function shellToast( options: ToastOptions ): () => void {
	const os = (
		window as { wp?: { os?: { showToast?: ( toastOptions: ToastOptions ) => () => void } } }
	).wp?.os;
	if ( typeof os?.showToast !== 'function' ) {
		return () => undefined;
	}
	return os.showToast( options ) ?? ( () => undefined );
}
