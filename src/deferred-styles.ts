import type { DesktopConfig } from './types';

const injected = new Set< string >();

export function ensureDeferredStyle( handle: string ): void {
	if ( injected.has( handle ) ) {
		return;
	}
	const config = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;
	const entry = config?.deferredStyles?.[ handle ];
	if ( ! entry?.url ) {
		return;
	}

	injected.add( handle );

	const safeUrl = entry.url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
	const existing = document.head.querySelector< HTMLLinkElement >(
		`link[rel="stylesheet"][href="${ safeUrl }"]`,
	);
	if ( ! existing ) {
		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = entry.url;
		link.dataset.osStyleHandle = handle;
		document.head.appendChild( link );
	}
	for ( const css of entry.inline ?? [] ) {
		if ( typeof css !== 'string' || css === '' ) {
			continue;
		}
		const style = document.createElement( 'style' );
		style.dataset.osStyleHandle = handle;
		style.textContent = css;
		document.head.appendChild( style );
	}
}

export function __resetDeferredStylesForTests(): void {
	injected.clear();
}
