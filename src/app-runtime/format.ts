/**
 * App Framework — shared formatting primitives.
 *
 * Every app renders the same few value shapes — a byte count, a
 * timestamp — and before this module each app carried its own copy
 * of the formatters (five date helpers and a second `formatBytes`
 * between the first two apps alone). These are re-exported from
 * `@openstation/app`, so an `.os.ts` view reaches them with the same
 * import it already uses for `html` and `__`.
 *
 * For "N minutes ago" rendering use `<os-relative-time>` instead —
 * live-updating relative time is a component concern, not a string
 * formatter's.
 *
 * @public
 */

export { formatBytes } from '../os-file-drop/format-bytes';

/** The named renderings `formatDate` can produce. */
export type DateStyle = 'short' | 'long' | 'month' | 'datetime' | 'iso';

/**
 * Render a date in one of the app kit's named styles.
 *
 * Accepts an ISO 8601 string (a bare `YYYY-MM` month is read as that
 * month's first day, local time), an epoch-milliseconds number, or a
 * `Date`. An empty value renders as `''`; an unparseable one renders
 * as itself, so a bad payload degrades to visible raw data rather
 * than `Invalid Date`.
 *
 * - `short`    — `Aug 31`
 * - `long`     — `Aug 31, 2026`
 * - `month`    — `August 2026`
 * - `datetime` — `Aug 31, 10:15:03 PM`
 * - `iso`      — `2026-08-31T22:15:03.000Z`
 */
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
