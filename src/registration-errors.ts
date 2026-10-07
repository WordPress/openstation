type FieldCheck<T> = {

	field: string;

	valid: ( d: Partial< T > ) => boolean;

	message: string;
};

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

export class RegistrationError extends Error {
	public readonly kind: string;
	public readonly errors: string[];
	public readonly def: unknown;

	constructor( kind: string, errors: string[], def: unknown ) {
		super(
			`[openstation] ${ kind } registration rejected — fields: ` +
				errors.join( ', ' ) +
				'.',
		);
		this.name = 'RegistrationError';
		this.kind = kind;
		this.errors = errors;
		this.def = def;
	}
}

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

export function logRegistrationErrors(
	kind: string,
	errors: string[],
	def: unknown,
): void {
	if ( typeof console === 'undefined' ) {
		return;
	}
	console.warn(
		`[openstation] ${ kind } registration rejected — fields: ` +
			errors.join( ', ' ) +
			'.',
		def,
	);
}
