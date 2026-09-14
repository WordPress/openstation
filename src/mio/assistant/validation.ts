/** Only identified, offered tools may receive recoverable argument feedback. */
import { mioBytes } from './budget';
import { MioValidationError } from './operations';
import type { MioAbility, MioArgumentError, MioCallContext, MioValidationResult } from './types';

export function argumentError( code: string, message: string ): MioValidationError {
	return new MioValidationError( [ { code, path: '$', message } ] );
}

/** Keep feedback bounded; an invalid validator response is terminal. */
export function validationErrors( value: unknown ): MioArgumentError[] {
	if ( ! Array.isArray( value ) || ! value.length || value.length > 20 ) {
		throw new Error( 'Invalid MIO validation feedback.' );
	}
	return value.map( ( error ) => {
		if ( ! error || typeof error.code !== 'string' || typeof error.path !== 'string' || typeof error.message !== 'string' ) {
			throw new Error( 'Invalid MIO validation feedback.' );
		}
		return { code: error.code.slice( 0, 80 ), path: error.path.slice( 0, 300 ), message: error.message.slice( 0, 1000 ), ...( typeof error.suggestion === 'string' ? { suggestion: error.suggestion.slice( 0, 1000 ) } : {} ) };
	} );
}

export function parseMioArguments( json: string, ability: MioAbility, context: MioCallContext ): Record<string, unknown> {
	if ( typeof json !== 'string' || mioBytes( json ) > 96000 ) {
		throw argumentError( 'argument_budget', 'Provide JSON arguments within 96,000 UTF-8 bytes; use a draft reference or a smaller patch for larger documents.' );
	}
	let args: unknown;
	try {
		args = JSON.parse( json );
	} catch {
		throw argumentError( 'invalid_json', 'Provide a valid JSON object for the tool arguments.' );
	}
	if ( ! args || typeof args !== 'object' || Array.isArray( args ) ) {
		throw argumentError( 'invalid_envelope', 'Expected an object containing the advertised argument properties.' );
	}
	const result: boolean | MioValidationResult = ability.validate( args as Record<string, unknown>, context );
	if ( result === false ) {
		throw argumentError( 'invalid_arguments', `Arguments do not satisfy ${ ability.name }; check its schema and live options.` );
	}
	if ( result !== true && result?.ok !== true ) {
		if ( ! result || result.ok !== false || typeof result.retryable !== 'boolean' ) {
			throw new Error( 'Invalid MIO validator result.' );
		}
		throw new MioValidationError( validationErrors( result.errors ), result.retryable );
	}
	return args as Record<string, unknown>;
}

/** Sort object keys so property order cannot bypass duplicate-write protection. */
export function mioArgumentKey( value: unknown ): string {
	if ( Array.isArray( value ) ) {
		return `[${ value.map( mioArgumentKey ).join( ',' ) }]`;
	}
	if ( value && typeof value === 'object' ) {
		return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ mioArgumentKey( ( value as Record<string, unknown> )[ key ] ) }` ).join( ',' ) }}`;
	}
	return JSON.stringify( value );
}
