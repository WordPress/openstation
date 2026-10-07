export function isPromise< T >( value: unknown ): value is Promise< T > {
	return (
		!! value &&
		typeof value === 'object' &&
		typeof ( value as { then?: unknown } ).then === 'function'
	);
}

export function isHexColor( value: unknown ): boolean {
	return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test( value );
}
