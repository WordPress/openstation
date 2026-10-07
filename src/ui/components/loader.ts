import { OS_COMPONENT_TAGS } from './tags';

declare global {

	interface Window {

		openStationComponents?: boolean;
	}
}

const KNOWN: ReadonlySet< string > = new Set( OS_COMPONENT_TAGS );

let inflight: Promise< void > | null = null;

function readiness(): boolean {
	return !! window.openStationComponents;
}

export function componentsBundleUrl(): string {
	const cfg = (
		window as unknown as {
			openStationConfig?: { componentsBundleUrl?: string };
		}
	).openStationConfig;
	return cfg?.componentsBundleUrl ?? '';
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const finish = (): void => {
			if ( readiness() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] component kit loaded but did not set `window.openStationComponents`.',
				),
			);
		};
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-components="1"]',
		);
		if ( existing ) {
			if ( readiness() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load component kit' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osComponents = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load component kit' ) ),
		);
		document.head.appendChild( s );
	} );
}

function reportUnknown( tags: readonly string[] ): void {
	const unknown = tags.filter( ( tag ) => ! KNOWN.has( tag ) );
	if ( unknown.length === 0 || typeof console === 'undefined' ) {
		return;
	}
	console.error(
		`[openstation] wp.os.loadComponents(): not a component — ${ unknown
			.map( ( t ) => `<${ t }>` )
			.join(
				', ',
			) }. The kit registers ${ OS_COMPONENT_TAGS.length } tags; see docs/components-reference.md for the list. The others in this call still loaded.`,
	);
}

export async function loadComponents(
	tags?: readonly string[],
): Promise< void > {
	if ( tags ) {
		reportUnknown( tags );
		const pending = tags.filter(
			( tag ) => KNOWN.has( tag ) && ! customElements.get( tag ),
		);
		if ( pending.length === 0 ) {
			return;
		}
	} else if ( readiness() ) {
		return;
	}

	const url = componentsBundleUrl();
	if ( ! url ) {
		return;
	}
	if ( ! inflight ) {
		inflight = injectScript( url ).catch( ( err ) => {
			inflight = null;
			throw err;
		} );
	}
	await inflight;
}
