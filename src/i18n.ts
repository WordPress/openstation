export const TEXT_DOMAIN = 'desktop-mode';

interface WpI18n {
	__: ( text: string, domain?: string ) => string;
	_x: ( text: string, context: string, domain?: string ) => string;
	_n: (
		single: string,
		plural: string,
		number: number,
		domain?: string,
	) => string;
	_nx: (
		single: string,
		plural: string,
		number: number,
		context: string,
		domain?: string,
	) => string;
	sprintf: ( format: string, ...args: unknown[] ) => string;
}

declare global {
	interface WpGlobal {
		i18n?: WpI18n;
	}
}

function i18n(): WpI18n | undefined {
	return window.wp?.i18n;
}

export function __( text: string, domain: string = TEXT_DOMAIN ): string {
	return i18n()?.__( text, domain ) ?? text;
}

export function _x(
	text: string,
	context: string,
	domain: string = TEXT_DOMAIN,
): string {
	return i18n()?._x( text, context, domain ) ?? text;
}

export function _n(
	single: string,
	plural: string,
	number: number,
	domain: string = TEXT_DOMAIN,
): string {
	return (
		i18n()?._n( single, plural, number, domain ) ??
		( number === 1 ? single : plural )
	);
}

export function _nx(
	single: string,
	plural: string,
	number: number,
	context: string,
	domain: string = TEXT_DOMAIN,
): string {
	return (
		i18n()?._nx( single, plural, number, context, domain ) ??
		( number === 1 ? single : plural )
	);
}

export function sprintf( format: string, ...args: unknown[] ): string {
	const impl = i18n()?.sprintf;
	if ( impl ) {
		return impl( format, ...args );
	}

	let i = 0;
	return format.replace( /%(?:(\d+)\$)?[sd]/g, ( _match, pos ) => {
		const idx = pos ? Number.parseInt( pos, 10 ) - 1 : i++;
		return String( args[ idx ] ?? '' );
	} );
}
