export const CONSTELLATION_FLAG = 'data-os-constellation';

export function isConstellationMounted(): boolean {
	return document.body.hasAttribute( CONSTELLATION_FLAG );
}
