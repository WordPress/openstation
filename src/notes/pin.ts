export const PIN_TIP_X = 0.57;
export const PIN_TIP_Y = 0.525;

export const PIN_WIDTH = 56;
export const PIN_HEIGHT = 52;

export function pushpinUrl( pluginUrl: string ): string {
	return `${ pluginUrl.replace( /\/$/, '' ) }/assets/images/pushpin.svg`;
}

export function buildPinImage( pluginUrl: string ): HTMLImageElement {
	const img = document.createElement( 'img' );
	img.src = pushpinUrl( pluginUrl );
	img.alt = '';
	img.width = PIN_WIDTH;
	img.height = PIN_HEIGHT;
	img.draggable = false;
	img.className = 'os-pinned-note__pin-img';
	return img;
}
