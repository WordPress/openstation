const DASHICON_PATTERN = /^dashicons-[a-z0-9-]+$/i;
const INLINE_SVG_PATTERN = /^\s*<svg[\s>]/i;

export function paintTitleBarButtonIcon(
	host: HTMLElement,
	icon: string,
): void {
	if ( ! icon ) {
		return;
	}
	if ( DASHICON_PATTERN.test( icon ) ) {
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ icon }`;
		span.setAttribute( 'aria-hidden', 'true' );
		host.appendChild( span );
		return;
	}
	if ( INLINE_SVG_PATTERN.test( icon ) ) {
		const wrapper = document.createElement( 'span' );
		wrapper.setAttribute( 'aria-hidden', 'true' );
		wrapper.innerHTML = icon;
		host.appendChild( wrapper );
		return;
	}

	host.setAttribute( 'icon', icon );
}
