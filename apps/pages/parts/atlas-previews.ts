export function selectPreviews( visible: number[], mounted: number[], selected: number | null, zoom: number ): number[] {
	if ( zoom < .4 ) {
		return [];
	}
	const onScreen = new Set( visible );
	const kept = mounted.filter( ( id ) => onScreen.has( id ) );
	if ( zoom < .5 ) {
		return kept.slice( 0, 6 );
	}
	return [ ...new Set( [ ...( selected !== null && onScreen.has( selected ) ? [ selected ] : [] ), ...kept, ...visible ] ) ].slice( 0, 6 );
}
