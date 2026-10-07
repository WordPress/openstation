const NAMESPACE = 'os.mio.';

export function doAction< TArgs extends unknown[] = unknown[] >(
	hookName: string,
	...args: TArgs
): void {
	if ( ! hookName.startsWith( NAMESPACE ) ) {
		return;
	}
	const name = `mio:${ hookName.slice( NAMESPACE.length ) }`;
	try {
		document.dispatchEvent(
			new CustomEvent( name, { detail: args[ 0 ] ?? {} } ),
		);
	} catch {

	}
}

export function applyFilters< TValue >(
	_hookName: string,
	value: TValue,
): TValue {
	return value;
}

export function addAction(): void {

}

export function addFilter(): void {

}

export const HOOKS: Record< string, string > = {};
