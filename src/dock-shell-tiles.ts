export const ASSISTANT_TILE_ID = 'os-site-assistant';
export const OVERVIEW_TILE_ID = 'os-overview';
export const SYSTEM_TILE_ID = 'os-system';

export const SYSTEM_TILE_ORDER = {
	assistant: 5,
	mio: 10,
	overview: 20,
	system: 30,
	exit: 35,
} as const;

export const OS_OVERVIEW_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round">' +
	'<rect x="6" y="6" width="27" height="27" rx="5"/>' +
	'<rect x="43" y="6" width="15" height="15" rx="5"/>' +
	'<rect x="43" y="31" width="15" height="27" rx="5"/>' +
	'<rect x="6" y="43" width="27" height="15" rx="5"/>' +
	'</svg>';

export const OS_OVERVIEW_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_OVERVIEW_SVG,
) }`;

export const OS_SYSTEM_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">' +
	'<path d="M10 22h44M10 42h44"/>' +
	'<circle cx="24" cy="22" r="7" fill="currentColor" stroke="none"/>' +
	'<circle cx="42" cy="42" r="7" fill="currentColor" stroke="none"/>' +
	'</svg>';

export const OS_SYSTEM_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_SYSTEM_SVG,
) }`;

export const OS_ASSISTANT_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
	'<path d="M10 2.5Q10.9 8.5 17.5 10Q10.9 11.5 10 17.5Q9.1 11.5 2.5 10Q9.1 8.5 10 2.5Z"/>' +
	'<path d="M17.9 14Q18.35 17.1 21.5 17.6Q18.35 18.1 17.9 21.2Q17.45 18.1 14.3 17.6Q17.45 17.1 17.9 14Z"/>' +
	'</svg>';

export const OS_ASSISTANT_ICON = `data:image/svg+xml;base64,${ btoa(
	OS_ASSISTANT_SVG,
) }`;
