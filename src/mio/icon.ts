/** Shared MIO identity for the dock and per-window toggle. */
export const MIO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
<defs><linearGradient id="mio" x1="19" y1="19" x2="5" y2="5" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#3f6dff"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#ff4fd8"/>
</linearGradient></defs>
<circle cx="12" cy="12" r="8.2" fill="none" stroke="url(#mio)" stroke-width="2.6"/>
<rect x="8" y="9.6" width="2.9" height="4.8" rx="1.45" fill="#fff"/>
<rect x="13.1" y="9.6" width="2.9" height="4.8" rx="1.45" fill="#fff"/>
</svg>`;

/** The same art as a data URI, ready for `renderIcon()`. */
export const MIO_TILE_ICON = `data:image/svg+xml;base64,${ btoa(
	MIO_ICON_SVG,
) }`;
