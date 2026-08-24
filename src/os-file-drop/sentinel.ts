/**
 * OpenStation — OS-file-drop sentinel.
 *
 * The only part of the file-drop feature that lives in the shell
 * bundle. Everything heavy (dialog, progress HUD, upload pipeline —
 * the `file-drop[.min].js` bundle) loads on the FIRST dragenter that
 * carries files: by the time a human has dragged across the window
 * and released, a same-host bundle fetch has long resolved.
 *
 * The race that can still lose: a drop landing before the bundle has
 * booted. `DataTransfer` is only readable during the event, so the
 * interim handlers here (a) keep the drop legal (`preventDefault` on
 * dragover — without it the browser navigates to the file), and (b)
 * on a too-early drop, synchronously capture the `File` objects plus
 * the drop point and hand them to the bundle's
 * `replayCapturedDrop()` once it is up. A replayed FOLDER drop
 * flattens to its files (directory traversal needs the live event) —
 * the documented cost of losing the race, which beats losing the
 * drop.
 *
 * Internal tile drags never trigger any of this: they carry custom
 * drag types, not `Files`.
 */

import { __ } from '../i18n';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { showToast } from '../toast';
import type { CapturedDrop } from './index';

interface SentinelArgs {
	/** `file-drop[.min].js` URL from `config.fileDropBundleUrl`. */
	bundleUrl: string;
	/** Boot args forwarded verbatim to `bootOsFileDrop()`. */
	boot: Parameters<
		NonNullable< Window[ 'openStationFileDrop' ] >[ 'boot' ]
	>[ 0 ];
}

function dragCarriesFiles( ev: DragEvent ): boolean {
	const types = ev.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	return Array.from( types ).includes( 'Files' );
}

export function installFileDropSentinel( args: SentinelArgs ): () => void {
	if ( ! args.bundleUrl ) {
		return () => undefined;
	}
	let loading: Promise< void > | null = null;
	let booted = false;
	const captured: CapturedDrop[] = [];

	const teardown = (): void => {
		window.removeEventListener( 'dragenter', onDragEnter, true );
		window.removeEventListener( 'dragover', onDragOver );
		window.removeEventListener( 'drop', onDrop );
	};

	const ensure = (): Promise< void > => {
		if ( ! loading ) {
			loading = loadVendorScript( args.bundleUrl )
				.then( () => {
					const api = window.openStationFileDrop;
					if ( ! api ) {
						return;
					}
					api.boot( args.boot );
					booted = true;
					// The real manager owns the listeners now.
					teardown();
					for ( const drop of captured.splice( 0 ) ) {
						api.replayCapturedDrop( drop );
					}
				} )
				.catch( ( err ) => {
					// Allow a retry on the next gesture — a flaky
					// fetch must not permanently kill file drops.
					loading = null;
					// eslint-disable-next-line no-console -- a dead drop path would otherwise fail silently.
					console.warn(
						'[openstation] file-drop bundle failed to load',
						err,
					);
					// A captured drop is USER DATA in limbo — failing
					// it silently would read as the desktop eating
					// files. Say so, and let the retry-on-next-gesture
					// contract do the rest.
					if ( captured.length > 0 ) {
						captured.length = 0;
						showToast( {
							message: __(
								'That drop could not be processed — please try again.',
								'desktop-mode',
							),
						} );
					}
				} );
		}
		return loading;
	};

	const onDragEnter = ( ev: DragEvent ): void => {
		if ( dragCarriesFiles( ev ) ) {
			void ensure();
		}
	};
	const onDragOver = ( ev: DragEvent ): void => {
		if ( ! booted && dragCarriesFiles( ev ) ) {
			ev.preventDefault();
			// Same cursor the real manager shows, so the pre-boot →
			// post-boot handover doesn't flicker the drag icon.
			if ( ev.dataTransfer ) {
				ev.dataTransfer.dropEffect = 'copy';
			}
		}
	};
	const onDrop = ( ev: DragEvent ): void => {
		if ( booted || ! dragCarriesFiles( ev ) ) {
			return;
		}
		ev.preventDefault();
		captured.push( {
			files: ev.dataTransfer ? Array.from( ev.dataTransfer.files ) : [],
			clientX: ev.clientX,
			clientY: ev.clientY,
			target: ev.target,
		} );
		void ensure();
	};

	// Capture-phase dragenter so the load kicks off before any other
	// handler can stop propagation; bubble-phase for the other two so
	// real drop targets (tiles, windows) keep their first look.
	window.addEventListener( 'dragenter', onDragEnter, true );
	window.addEventListener( 'dragover', onDragOver );
	window.addEventListener( 'drop', onDrop );
	// The teardown the boot path runs itself; returned for callers
	// (and tests) that need to uninstall an un-booted sentinel.
	return teardown;
}
