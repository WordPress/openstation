/**
 * Desktop Mode — Shared registration-error helpers.
 *
 * Plugin authors that register a widget / wallpaper / module with a
 * malformed def used to see a generic
 * `[wp-desktop-mode] Ignored invalid widget registration: { ... }`
 * warning and have to guess which field failed. These helpers collect
 * per-field errors instead, so the console message tells them exactly
 * what's wrong:
 *
 *   [wp-desktop-mode] Widget registration rejected — fields: id (missing), mount (not a function).
 *
 * Factored out so every registry validates with the same ergonomics.
 *
 * @since 0.8.2
 */

type FieldCheck<T> = {
	/** Human name of the field, used in the error message. */
	field: string;
	/** True when the field passes. Falsy → the `message` gets reported. */
	valid: ( d: Partial< T > ) => boolean;
	/**
	 * Short suffix after the field name in the composed error, e.g.
	 * `"id"` + `"missing"` → `"id (missing)"`. Keep terse — plugin
	 * authors read it at a glance.
	 */
	message: string;
};

/**
 * Run a list of per-field checks against a def. Returns an empty
 * array when everything passes, or a list of `field (reason)` strings
 * when something's off.
 */
export function collectRegistrationErrors<T>(
	def: unknown,
	checks: FieldCheck< T >[],
): string[] {
	if ( ! def || typeof def !== 'object' ) {
		return [ 'def (not an object)' ];
	}
	const d = def as Partial< T >;
	const errors: string[] = [];
	for ( const check of checks ) {
		if ( ! check.valid( d ) ) {
			errors.push( `${ check.field } (${ check.message })` );
		}
	}
	return errors;
}

/**
 * Thrown by every direct registration entry point when validation
 * fails. Carries the registry kind ("Command", "Wallpaper", …), the
 * per-field error list, and the offending def so callers can branch
 * on a typed error rather than parsing a string.
 *
 * @public
 */
export class RegistrationError extends Error {
	public readonly kind: string;
	public readonly errors: string[];
	public readonly def: unknown;

	constructor( kind: string, errors: string[], def: unknown ) {
		super(
			`[wp-desktop-mode] ${ kind } registration rejected — fields: ` +
				errors.join( ', ' ) +
				'.',
		);
		this.name = 'RegistrationError';
		this.kind = kind;
		this.errors = errors;
		this.def = def;
	}
}

/**
 * Throw a {@link RegistrationError} when `errors` is non-empty.
 *
 * The default for direct registration calls (`registerCommand`,
 * `registerWallpaper`, …): make failures audible. Plugin authors
 * stare at "the button never appeared" for hours when registrations
 * fail silently — throwing turns 30 minutes of guessing into a
 * console-frame they can read.
 *
 * Server-sync loops that register many defs in a row should wrap
 * each call in try/catch (or use {@link logRegistrationErrors}) so
 * one bad def doesn't kill the batch.
 */
export function throwOnRegistrationErrors(
	kind: string,
	errors: string[],
	def: unknown,
): void {
	if ( errors.length === 0 ) {
		return;
	}
	throw new RegistrationError( kind, errors, def );
}

/**
 * Non-throwing variant — log the rejection and continue. For batch
 * paths (server-sync hydration) where one bad def shouldn't break
 * everything else.
 */
export function logRegistrationErrors(
	kind: string,
	errors: string[],
	def: unknown,
): void {
	if ( typeof console === 'undefined' ) {
		return;
	}
	console.warn(
		`[wp-desktop-mode] ${ kind } registration rejected — fields: ` +
			errors.join( ', ' ) +
			'.',
		def,
	);
}
