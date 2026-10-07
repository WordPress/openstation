export { formatBytes } from '../os-file-drop/format-bytes';

export type DateStyle = 'short' | 'long' | 'month' | 'datetime' | 'iso';

export function formatDate(
	value: string | number | Date,
	style: DateStyle = 'short',
): string {
	if ( value === '' || value === null || value === undefined ) {
		return '';
	}
	const input =
		typeof value === 'string' && /^\d{4}-\d{2}$/.test( value )
			? `${ value }-01T00:00:00`
			: value;
	const date = input instanceof Date ? input : new Date( input );
	if ( Number.isNaN( date.getTime() ) ) {
		return String( value );
	}
	try {
		switch ( style ) {
			case 'long':
				return date.toLocaleDateString( undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
				} );
			case 'month':
				return date.toLocaleDateString( undefined, {
					year: 'numeric',
					month: 'long',
				} );
			case 'datetime':
				return date.toLocaleString( undefined, {
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				} );
			case 'iso':
				return date.toISOString();
			default:
				return date.toLocaleDateString( undefined, {
					month: 'short',
					day: 'numeric',
				} );
		}
	} catch {
		return String( value );
	}
}
