/**
 * Routines — humanize conditions / operands.
 *
 * Turns raw routine expressions (`{{payload.comment.content}} matches
 * /(casino|bitcoin)/i`) into plain English a non-technical user can
 * grasp at a glance ("Comment content contains casino or bitcoin").
 *
 * Used by the canvas to render Gate / IF cards in friendly form.
 * The inspector still surfaces the raw expression in its fields so
 * power users can edit precisely.
 *
 * @since 0.22.0
 */

import type { Catalog, Operator, RoutineCondition, RoutineStep } from './types';

/**
 * Humanize a single condition into a sentence-fragment phrase.
 *
 * @param cond      Condition.
 * @param catalog   Resolved catalog (used to label payload paths).
 * @param triggerId The current routine's trigger id (drives schema lookups).
 */
export function humanizeCondition(
	cond: RoutineCondition,
	catalog: Catalog,
	triggerId: string,
): string {
	// Special case: regex of OR-joined words → "contains any of: a, b, c".
	// Far more readable than literal `matches /(a|b|c)/i`.
	if ( cond.op === 'matches' && typeof cond.right === 'string' ) {
		const words = extractRegexAlternation( cond.right );
		if ( words ) {
			return `${ humanizeOperand( cond.left, catalog, triggerId ) } contains any of: ${ words.join( ', ' ) }`;
		}
	}

	const left = humanizeOperand( cond.left, catalog, triggerId );
	const verb = OP_VERB[ cond.op ] ?? cond.op;
	if ( cond.op === 'truthy' || cond.op === 'falsy' ) {
		return `${ left } ${ verb }`;
	}
	const right = humanizeOperand( cond.right, catalog, triggerId );
	return `${ left } ${ verb } ${ right }`;
}

/**
 * Humanize a routine step's summary line (used for the in-card
 * preview under the title).
 */
export function humanizeStepSummary(
	step: RoutineStep,
	catalog: Catalog,
	triggerId: string,
): string {
	const args = ( step.args ?? {} ) as Record< string, unknown >;
	if ( step.kind === 'if' && step.condition ) {
		return humanizeCondition( step.condition, catalog, triggerId );
	}
	if ( step.kind === 'log' ) {
		const msg = String( args.message ?? '' );
		return msg.length > 80 ? `${ msg.slice( 0, 80 ) }…` : msg;
	}
	if ( step.kind === 'email' ) {
		const to = humanizeOperand( args.to, catalog, triggerId ) || 'admin';
		const subject = String( args.subject ?? '' );
		return `to ${ to }${ subject ? ` — ${ subject.slice( 0, 50 ) }` : '' }`;
	}
	if ( step.kind === 'http' ) {
		return `${ String( args.method ?? 'GET' ).toUpperCase() } ${ String( args.url ?? '' ).slice( 0, 60 ) }`;
	}
	if ( step.kind === 'wait' ) {
		return `${ String( args.seconds ?? 1 ) }s`;
	}
	if ( step.kind === 'set_var' ) {
		return `${ args.name } = ${ JSON.stringify( args.value ) }`;
	}
	if ( step.kind === 'stop' ) {
		return String( args.reason ?? '' );
	}
	if ( step.kind === 'action' || step.kind === 'ai_tool' ) {
		const keys = Object.keys( args );
		if ( keys.length === 0 ) {
			return '';
		}
		const first = keys
			.slice( 0, 3 )
			.map(
				( k ) =>
					`${ k }: ${ humanizeOperand( args[ k ], catalog, triggerId ) }`,
			)
			.join( ', ' );
		return first;
	}
	return '';
}

/**
 * Map an operator slug to a sentence-fragment verb.
 *
 * `eq` → "is" (not "==")
 * `gt` → "greater than" (not ">")
 * `matches` → "matches pattern" (rarely shown — see special-case above)
 *
 * @internal
 */
const OP_VERB: Record< Operator, string > = {
	eq: 'is',
	neq: 'is not',
	gt: 'is greater than',
	gte: 'is at least',
	lt: 'is less than',
	lte: 'is at most',
	contains: 'contains',
	starts_with: 'starts with',
	ends_with: 'ends with',
	matches: 'matches pattern',
	in: 'is one of',
	not_in: 'is not one of',
	truthy: 'is set',
	falsy: 'is empty',
};

/**
 * Render a single operand (left or right) friendly:
 *
 *   `{{payload.comment.content}}` → "Comment content"
 *   `{{vars.spam_check.message}}` → "spam_check result.message"
 *   `42`                          → `42`
 *   `'casino'`                    → `casino`
 *
 * @internal
 */
function humanizeOperand(
	value: unknown,
	catalog: Catalog,
	triggerId: string,
): string {
	if ( value === null || value === undefined || value === '' ) {
		return '—';
	}
	if ( typeof value !== 'string' ) {
		return String( value );
	}
	const placeholder = parseSinglePlaceholder( value );
	if ( ! placeholder ) {
		return value;
	}
	const path = placeholder;
	if ( path.startsWith( 'payload.' ) ) {
		const sub = path.slice( 'payload.'.length );
		return labelForPayloadPath( sub, catalog, triggerId );
	}
	if ( path.startsWith( 'vars.' ) ) {
		return path.slice( 'vars.'.length ).replace( /\./g, ' › ' );
	}
	if ( path === 'site.url' ) {
		return 'site URL';
	}
	if ( path === 'site.name' ) {
		return 'site name';
	}
	if ( path === 'user.id' ) {
		return 'current user ID';
	}
	return path;
}

/**
 * Look up a payload path in the active trigger's `payload_schema`.
 * Prefers `description` from the schema, falls back to a Title-Cased
 * version of the path's last meaningful segment.
 *
 * @internal
 */
function labelForPayloadPath(
	path: string,
	catalog: Catalog,
	triggerId: string,
): string {
	const trigger = catalog.triggers.find( ( t ) => t.id === triggerId );
	if ( trigger ) {
		const schema = trigger.payload_schema as
			| Record< string, { description?: string } >
			| undefined;
		if ( schema && schema[ path ]?.description ) {
			return schema[ path ].description as string;
		}
	}
	// Fallback — turn `comment.content` into "Comment content".
	const segments = path.split( '.' );
	const last = segments[ segments.length - 1 ] ?? path;
	const friendly = last
		.replace( /_/g, ' ' )
		.replace( /([a-z])([A-Z])/g, '$1 $2' )
		.toLowerCase();
	const head = segments
		.slice( 0, -1 )
		.map( ( s ) => s.charAt( 0 ).toUpperCase() + s.slice( 1 ).toLowerCase() )
		.join( ' ' );
	return ( head ? `${ head } ${ friendly }` : friendly )
		.charAt( 0 )
		.toUpperCase() +
		( head ? `${ head } ${ friendly }` : friendly ).slice( 1 );
}

/**
 * Match a value that's exactly one `{{path}}` placeholder, no
 * surrounding text. Returns the path or null.
 *
 * @internal
 */
function parseSinglePlaceholder( value: string ): string | null {
	const m = value.match( /^\s*\{\{\s*([a-zA-Z0-9_.\[\]\-]+)\s*\}\}\s*$/ );
	return m ? m[ 1 ] : null;
}

/**
 * If `regex` looks like `/(a|b|c)/[flags]` (or its variants),
 * return the alternation words; null otherwise. Used to render
 * spam-keyword-style filters as "contains any of: a, b, c".
 *
 * @internal
 */
function extractRegexAlternation( regex: string ): string[] | null {
	const m = regex.match( /^\/\(?([^/\\]+)\)?\/[a-z]*$/ );
	if ( ! m ) {
		return null;
	}
	const inner = m[ 1 ];
	if ( ! inner.includes( '|' ) ) {
		return null;
	}
	return inner.split( '|' ).map( ( s ) => s.trim() ).filter( Boolean );
}
