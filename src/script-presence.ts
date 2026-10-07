export interface ScriptRef {

	url?: string;

	handle?: string;
}

export function findScriptByPath( url: string ): HTMLScriptElement | null {
	let origin: string;
	let path: string;
	try {
		const parsed = new URL( url, document.baseURI );
		origin = parsed.origin;
		path = parsed.pathname;
	} catch {
		return null;
	}
	if ( ! path ) {
		return null;
	}
	const tags = document.querySelectorAll< HTMLScriptElement >(
		'script[src]',
	);
	for ( const tag of Array.from( tags ) ) {
		try {
			const candidate = new URL( tag.src, document.baseURI );
			if (
				candidate.origin === origin &&
				candidate.pathname === path
			) {
				return tag;
			}
		} catch {

		}
	}
	return null;
}

const concatenated = new Map< string, string[] >();

function handlesInConcatUrl( src: string ): string[] {
	const memo = concatenated.get( src );
	if ( memo ) {
		return memo;
	}

	let handles: string[] = [];
	try {
		const url = new URL( src, document.baseURI );
		if ( url.pathname.endsWith( '/load-scripts.php' ) ) {
			const chunks: Array< { order: number; value: string } > = [];
			url.searchParams.forEach( ( value, key ) => {
				if ( 'load' !== key && ! key.startsWith( 'load[' ) ) {
					return;
				}
				const index = /(\d+)/.exec( key );
				chunks.push( {
					order: index ? Number( index[ 1 ] ) : chunks.length,
					value,
				} );
			} );
			chunks.sort( ( a, b ) => a.order - b.order );
			handles = chunks
				.map( ( chunk ) => chunk.value )
				.join( '' )
				.split( ',' )
				.map( ( handle ) => handle.trim() )
				.filter( Boolean );
		}
	} catch {

	}

	concatenated.set( src, handles );
	return handles;
}

export function concatenatedScriptHandles(): Set< string > {
	const handles = new Set< string >();
	const tags = document.querySelectorAll< HTMLScriptElement >(
		'script[src*="load-scripts.php"]',
	);
	for ( const tag of Array.from( tags ) ) {
		for ( const handle of handlesInConcatUrl( tag.src ) ) {
			handles.add( handle );
		}
	}
	return handles;
}

const PRINTED_ID_SUFFIXES = [
	'-js',
	'-js-before',
	'-js-after',
	'-js-extra',
	'-js-translations',
];

export function printedScriptHandleInDocument( handle: string ): boolean {
	if ( ! handle ) {
		return false;
	}
	return PRINTED_ID_SUFFIXES.some( ( suffix ) => {
		const tag = document.getElementById( handle + suffix );
		return !! tag && tag.tagName === 'SCRIPT';
	} );
}

export function isScriptInDocument( ref: ScriptRef ): boolean {
	if ( ref.url && findScriptByPath( ref.url ) ) {
		return true;
	}
	if ( ! ref.handle ) {
		return false;
	}
	return (
		concatenatedScriptHandles().has( ref.handle ) ||
		printedScriptHandleInDocument( ref.handle )
	);
}
