const TEETH = 8;

const tooth = ( index: number ): string =>
	`<rect x="28" y="5" width="8" height="12" rx="2" fill="currentColor" transform="rotate(${
		( 360 / TEETH ) * index
	} 32 32)"/>`;

export const OS_GEAR_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
	Array.from( { length: TEETH }, ( _, i ) => tooth( i ) ).join( '' ) +
	'<circle cx="32" cy="32" r="15.5" fill="none" stroke="currentColor" stroke-width="9"/>' +
	'</svg>';

export const OS_GEAR_ICON = `data:image/svg+xml;base64,${ btoa( OS_GEAR_SVG ) }`;
