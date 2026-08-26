/**
 * OpenStation — dock-constellation sentinel.
 *
 * The hover-submenu flyout is pure hover UI: nothing about it is
 * needed until a pointer actually enters a dock rail. This sentinel
 * — the only constellation code in the shell bundle — waits for that
 * first pointerover, loads `dock-constellation[.min].js`, and mounts
 * the flyout with the deps the shell captured at boot. The flyout's
 * own hover-intent delay covers the one-time fetch; a fetch failure
 * degrades soft (every submenu stays reachable through the window's
 * tab strip) and the next hover retries.
 */

import { loadVendorScript } from '../wallpapers/vendor-loader';

type ConstellationDeps = Parameters<
	NonNullable< Window[ 'openStationDockConstellation' ] >[ 'mount' ]
>[ 0 ];

export function installDockConstellationSentinel( args: {
	/** `dock-constellation[.min].js` URL from the boot config. */
	bundleUrl: string;
	deps: ConstellationDeps;
} ): () => void {
	if ( ! args.bundleUrl ) {
		return () => undefined;
	}
	let loading = false;
	const onFirstDockHover = ( ev: Event ): void => {
		const target = ev.target;
		if (
			loading ||
			! ( target instanceof Element ) ||
			! target.closest( '.os-dock' )
		) {
			return;
		}
		loading = true;
		void loadVendorScript( args.bundleUrl )
			.then( () => {
				document.removeEventListener(
					'pointerover',
					onFirstDockHover,
					true,
				);
				window.openStationDockConstellation?.mount( args.deps );
			} )
			.catch( () => {
				// Retry on the next hover — see the module docblock.
				loading = false;
			} );
	};
	document.addEventListener( 'pointerover', onFirstDockHover, true );
	return () =>
		document.removeEventListener( 'pointerover', onFirstDockHover, true );
}
