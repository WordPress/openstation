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
