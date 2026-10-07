import { __ } from '../i18n';
import { isMobileStamped } from '../mode/stamp';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { showToast } from '../toast';
import type { CapturedDrop } from './index';

interface SentinelArgs {

	bundleUrl: string;

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
	if ( ! args.bundleUrl || isMobileStamped() ) {
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

					teardown();
					for ( const drop of captured.splice( 0 ) ) {
						api.replayCapturedDrop( drop );
					}
				} )
				.catch( ( err ) => {
					loading = null;

					console.warn(
						'[openstation] file-drop bundle failed to load',
						err,
					);

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

			if ( ev.dataTransfer ) {
				ev.dataTransfer.dropEffect = 'copy';
			}
		}
	};
	const onDrop = ( ev: DragEvent ): void => {
		if ( booted || ! dragCarriesFiles( ev ) ) {
			return;
		}

		const alreadyClaimed = ev.defaultPrevented;
		ev.preventDefault();
		captured.push( {
			files: ev.dataTransfer ? Array.from( ev.dataTransfer.files ) : [],
			clientX: ev.clientX,
			clientY: ev.clientY,
			target: ev.target,
			alreadyClaimed,
		} );
		void ensure();
	};

	window.addEventListener( 'dragenter', onDragEnter, true );
	window.addEventListener( 'dragover', onDragOver );
	window.addEventListener( 'drop', onDrop );

	return teardown;
}
