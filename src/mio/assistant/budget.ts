/** Limits mirror the PHP transport and count the actual serialized UTF-8 bytes. */
import type { MioTurnRequest } from './types';

export const MIO_REQUEST_LIMITS = Object.freeze( { prompt: 16000, transcript: 96000, tools: 96000, request: 220000 } );
export const mioBytes = ( value: string ): number => new TextEncoder().encode( value ).byteLength;

export class MioBudgetError extends Error {
	public readonly code = 'mio_request_budget';
	public readonly remainingBytes: number;
	public constructor( public readonly scope: keyof typeof MIO_REQUEST_LIMITS, public readonly usedBytes: number, public readonly limitBytes: number ) {
		super( `MIO ${ scope } budget exceeded (${ usedBytes }/${ limitBytes } UTF-8 bytes). Use a compact draft reference or smaller edit; no document was truncated.` );
		this.name = 'MioBudgetError';
		this.remainingBytes = Math.max( 0, limitBytes - usedBytes );
	}
}

// PHP checks tool definitions after wp_json_encode (escaped Unicode and slashes).
const phpJsonBytes = ( value: unknown ): string => JSON.stringify( value ).replace( /\//g, '\\/' ).replace( /[^\x00-\x7f]/g, ( character ) => `\\u${ character.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' ) }` );

export function assertMioRequestBudget( request: MioTurnRequest ): void {
	const fields = { prompt: request.prompt, transcript: request.transcript, tools: phpJsonBytes( request.tools ), request: JSON.stringify( request ) };
	for ( const scope of Object.keys( fields ) as Array<keyof typeof fields> ) {
		const bytes = mioBytes( fields[ scope ] );
		if ( bytes > MIO_REQUEST_LIMITS[ scope ] ) {
			throw new MioBudgetError( scope, bytes, MIO_REQUEST_LIMITS[ scope ] );
		}
	}
}
