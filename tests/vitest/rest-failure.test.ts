import { describe, expect, test, vi } from 'vitest';
import { RestError } from '../../src/core/api-client';
import {
	describeRestFailure,
	restFailureKind,
	restFailureText,
	toastRestFailure,
} from '../../src/core/rest-failure';

const FALLBACK = 'Could not restore the note.';

function restError(
	status: number,
	opts: { code?: string; serverMessage?: string; data?: unknown } = {},
): RestError {
	return new RestError( `[openstation] notes REST ${ status }: ${ opts.code ?? '' }`, {
		status,
		...opts,
	} );
}

describe( 'describeRestFailure', () => {
	test( 'a refusal shows the server’s own message', () => {
		const out = describeRestFailure(
			restError( 403, {
				code: 'openstation_notes_forbidden',
				serverMessage: 'Only the note owner can change it.',
			} ),
			{ fallback: FALLBACK },
		);
		expect( out.kind ).toBe( 'refused' );
		expect( out.type ).toBe( 'error' );
		expect( out.message ).toBe( 'Only the note owner can change it.' );
		expect( out.reason ).toBe( out.message );
	} );

	test( 'an expired nonce is a session line, whatever the status', () => {
		const out = describeRestFailure(
			restError( 403, {
				code: 'rest_cookie_invalid_nonce',
				serverMessage: 'Cookie check failed',
			} ),
			{ fallback: FALLBACK },
		);
		expect( out.kind ).toBe( 'session' );
		expect( out.message ).toMatch( /session has expired/ );
	} );

	test( 'a 404 without a message says the object is gone, on the caller’s line', () => {
		const out = describeRestFailure( restError( 404 ), { fallback: FALLBACK } );
		expect( out.kind ).toBe( 'gone' );
		expect( out.message ).toBe(
			'Could not restore the note. It no longer exists. Reload the page to catch up.',
		);
	} );

	test( 'a 5xx keeps the caller’s line and names the status', () => {
		const out = describeRestFailure( restError( 502 ), { fallback: FALLBACK } );
		expect( out.kind ).toBe( 'server' );
		expect( out.message ).toBe(
			'Could not restore the note. The server answered with error 502.',
		);
	} );

	test( 'an unreadable 2xx is a warning that says to reload', () => {
		const out = describeRestFailure(
			restError( 200, { code: 'openstation_bad_response' } ),
			{ fallback: FALLBACK },
		);
		expect( out.kind ).toBe( 'unreadable' );
		expect( out.type ).toBe( 'warning' );
		expect( out.message ).toMatch( /unreadable reply/ );
	} );

	test( 'a fetch rejection is offline', () => {
		const out = describeRestFailure( new TypeError( 'Failed to fetch' ), {
			fallback: FALLBACK,
		} );
		expect( out.kind ).toBe( 'offline' );
		expect( out.type ).toBe( 'warning' );
		expect( out.message ).toMatch( /Check your connection/ );
	} );

	test( 'anything else falls back to the caller’s line', () => {
		const out = describeRestFailure( new Error( 'boom' ), { fallback: FALLBACK } );
		expect( out.kind ).toBe( 'unknown' );
		expect( out.message ).toBe( 'boom' );
		expect( describeRestFailure( undefined, { fallback: FALLBACK } ).message ).toBe(
			FALLBACK,
		);
	} );

	test( 'a lead puts the verb in front of the reason, and never dangles', () => {
		const refused = describeRestFailure(
			restError( 403, { serverMessage: 'You are not allowed to edit this post.' } ),
			{ lead: 'Could not add to the post', fallback: 'Could not add to the post.' },
		);
		expect( refused.message ).toBe(
			'Could not add to the post: You are not allowed to edit this post.',
		);
		// A 2xx with no body has no reason of its own beyond the
		// unreadable line; a plain error with no message has none at all.
		expect(
			describeRestFailure( new Error( '' ), {
				lead: 'Could not add to the post',
				fallback: 'Could not add to the post.',
			} ).message,
		).toBe( 'Could not add to the post.' );
	} );
} );

describe( 'restFailureText', () => {
	test( 'is the server message, the offline line, or the error’s own message', () => {
		expect(
			restFailureText( restError( 403, { serverMessage: 'You cannot.' } ) ),
		).toBe( 'You cannot.' );
		expect( restFailureText( new TypeError( 'Failed to fetch' ) ) ).toMatch(
			/Check your connection/,
		);
		// An unreadable body has no human part: the caller’s fallback takes over.
		expect( restFailureText( restError( 200 ) ) ).toBe( '' );
	} );
} );

describe( 'restFailureKind', () => {
	test( 'classifies by status, with the nonce code winning over the status', () => {
		expect( restFailureKind( restError( 401 ) ) ).toBe( 'session' );
		expect( restFailureKind( restError( 403 ) ) ).toBe( 'refused' );
		expect( restFailureKind( restError( 409 ) ) ).toBe( 'refused' );
		expect( restFailureKind( restError( 500 ) ) ).toBe( 'server' );
		expect( restFailureKind( 'nope' ) ).toBe( 'unknown' );
	} );
} );

describe( 'toastRestFailure', () => {
	test( 'hands the message and type to the toast it was given, or nothing to none', () => {
		const toast = vi.fn();
		toastRestFailure( toast, restError( 500 ), { fallback: FALLBACK } );
		expect( toast ).toHaveBeenCalledWith( {
			message: 'Could not restore the note. The server answered with error 500.',
			type: 'error',
		} );
		expect( () => toastRestFailure( undefined, restError( 500 ), { fallback: FALLBACK } ) ).not.toThrow();
	} );
} );
