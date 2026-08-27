/**
 * OpenStation — dock-constellation sentinel.
 *
 * The hover-submenu flyout is hover UI, so nothing about it is needed
 * until a pointer enters a dock rail. This sentinel — the only
 * constellation code in the shell bundle — waits for that, loads
 * `dock-constellation[.min].js`, and mounts the flyout with the deps
 * the shell captured at boot. The flyout's own hover-intent delay
 * covers the one-time fetch; a fetch failure degrades soft (every
 * submenu stays reachable through the window's tab strip) and the next
 * attempt retries.
 *
 * It waits on `focusin` too, because hover UI is not hover-ONLY. The
 * flyout's documented keyboard entry point — the open arrow on a dock
 * tile — is registered inside `mountDockConstellation()`, so a
 * keyboard-only user who tabbed to a rail and pressed it got nothing:
 * the bundle holding that handler had never been requested, because no
 * pointer had crossed the dock. Enter on the tile still opened the page,
 * which made the flyout look absent rather than unloaded.
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
				document.removeEventListener(
					'focusin',
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
	// `focusin` as well as `pointerover`: the flyout is hover UI, but it
	// is not hover-ONLY. Its documented keyboard contract (the open
	// arrow on a dock tile) lives inside `mountDockConstellation()`, so
	// a keyboard-only user who tabbed to a rail pressed the key and got
	// nothing at all — the bundle carrying that handler had never been
	// asked for, because no pointer had crossed the dock.
	//
	// `focusin` bubbles (unlike `focus`), and the same
	// `closest( '.os-dock' )` test applies, so tabbing into any rail is
	// enough. Both listeners share the `loading` guard and the same
	// teardown.
	document.addEventListener( 'pointerover', onFirstDockHover, true );
	document.addEventListener( 'focusin', onFirstDockHover, true );
	return () => {
		document.removeEventListener( 'pointerover', onFirstDockHover, true );
		document.removeEventListener( 'focusin', onFirstDockHover, true );
	};
}
