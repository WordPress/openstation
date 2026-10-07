import { loadVendorScript } from '../wallpapers/vendor-loader';

type ConstellationDeps = Parameters<
	NonNullable< Window[ 'openStationDockConstellation' ] >[ 'mount' ]
>[ 0 ];

export function installDockConstellationSentinel( args: {

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
				loading = false;
			} );
	};

	document.addEventListener( 'pointerover', onFirstDockHover, true );
	document.addEventListener( 'focusin', onFirstDockHover, true );
	return () => {
		document.removeEventListener( 'pointerover', onFirstDockHover, true );
		document.removeEventListener( 'focusin', onFirstDockHover, true );
	};
}
