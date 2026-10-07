export function isMaskableIcon( icon: string ): boolean {
	if ( typeof icon !== 'string' || icon === '' || icon.length > 4096 ) {
		return false;
	}
	if ( ! /^(https?:\/\/|data:image\/)/i.test( icon ) ) {
		return false;
	}
	return ! /['"()\\<>\s]/.test( icon );
}

export function applyIconMask(
	el: HTMLElement,
	icon: string,
	color: string,
): boolean {
	if ( ! isMaskableIcon( icon ) ) {
		return false;
	}
	const mask = `url("${ icon }") center / contain no-repeat`;
	el.style.backgroundImage = 'none';
	el.style.backgroundColor = color;
	el.style.setProperty( '-webkit-mask', mask );
	el.style.setProperty( 'mask', mask );
	return true;
}
