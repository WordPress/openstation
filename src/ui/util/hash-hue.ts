export function hashTitleToHue( input: string ): number {
	if ( ! input ) {
		return 214;
	}

	let hash = 5381;
	for ( let i = 0; i < input.length; i++ ) {
		hash = Math.imul( hash, 33 ) + input.charCodeAt( i );
	}
	return ( ( hash % 360 ) + 360 ) % 360;
}
