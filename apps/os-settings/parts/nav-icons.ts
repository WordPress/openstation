import { isOsIconName, osIcon } from '../../../src/ui/icons';

type NavIconMap = Readonly< Partial< Record< string, () => SVGSVGElement > > >;

const NAV = { size: null } as const;

export const NAV_ICONS: NavIconMap = {

	appearance: () => osIcon( 'color', NAV ),

	themes: () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path fill-rule="evenodd" clip-rule="evenodd" d="M20 12a8 8 0' +
			' 1 1-16 0 8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 0 1-6.5 6.5v-13a6.5' +
			' 6.5 0 0 1 6.5 6.5Z" />';
		return svg;
	},

	windows: () => osIcon( 'windows', NAV ),

	navigation: () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0' +
			' 14.5c-3.6 0-6.5-2.9-6.5-6.5S8.4 5.5 12 5.5s6.5 2.9 6.5 6.5-2.9' +
			' 6.5-6.5 6.5zM9 16l4.5-3L15 8.4l-4.5 3L9 16z" />';
		return svg;
	},

	mobile: () => osIcon( 'window', NAV ),

	features: () => osIcon( 'settings', NAV ),

	help: () => osIcon( 'widgets', NAV ),

	'os-file-associations': () => {
		const svg = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'fill', 'currentColor' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML =
			'<path d="M15.5 7.5h-7V9h7V7.5Zm-7 3.5h7v1.5h-7V11Zm7 3.5h-7V16h7v-1.5Z" />' +
			'<path d="M17 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0' +
			' 2-2V6a2 2 0 0 0-2-2ZM7 5.5h10a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H7a.5.5' +
			' 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z" />';
		return svg;
	},

	about: () => osIcon( 'info', NAV ),
};

export function registryNavIcon( id: string, icon?: string ): ( () => SVGSVGElement ) | undefined {
	if ( icon && isOsIconName( icon ) ) {
		return () => osIcon( icon, NAV );
	}
	return NAV_ICONS[ id ];
}
