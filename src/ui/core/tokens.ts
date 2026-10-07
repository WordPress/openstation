export function readToken(
	tokenName: `--os-ui-${ string }`,
	el: Element = document.documentElement,
): string {
	const cs = getComputedStyle( el );
	return cs.getPropertyValue( tokenName ).trim();
}

export function setToken(
	el: HTMLElement,
	tokenName: `--os-ui-${ string }`,
	value: string,
): void {
	el.style.setProperty( tokenName, value );
}

export function isOsUiToken( name: string ): name is `--os-ui-${ string }` {
	return /^--os-ui-[a-z0-9-]+$/.test( name );
}

export const OS_FOUNDATION_TOKENS = {
	border: '--os-ui-border',
	borderStrong: '--os-ui-border-strong',
} as const;
