import { afterEach, describe, expect, test, vi } from 'vitest';
import { RestError } from '../../src/core/api-client';
import {
	describeRestFailure,
	restFailureKind,
	restFailureText,
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

afterEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.restoreAllMocks();
} );

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
		expect( out.action ).toBeUndefined();
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

	test( 'a settings_tab hint becomes an Open Preferences action when the shell can open one', () => {
		const openOsSettings = vi.fn();
		( window as unknown as { wp?: unknown } ).wp = { os: { openOsSettings } };
		const out = describeRestFailure(
			restError( 403, {
				code: 'openstation_ai_disabled',
				serverMessage: 'The AI assistant is turned off.',
				data: { status: 403, settings_tab: 'features' },
			} ),
			{ fallback: FALLBACK },
		);
		expect( out.action?.label ).toBe( 'Open Preferences' );
		out.action?.onClick();
		expect( openOsSettings ).toHaveBeenCalledWith( { tabId: 'features' } );

		// No opener published (a bundle outside the shell): a hint is not an action.
		delete ( window as unknown as { wp?: unknown } ).wp;
		expect(
			describeRestFailure(
				restError( 403, { data: { settings_tab: 'features' } } ),
				{ fallback: FALLBACK },
			).action,
		).toBeUndefined();
	} );
} );

describe( 'restFailureText', () => {
	test( 'reads the server message off a RestError and the prefix off a plain Error', () => {
		expect(
			restFailureText( restError( 403, { serverMessage: 'You cannot.' } ) ),
		).toBe( 'You cannot.' );
		// The console-line shape older callers and test doubles throw.
		expect(
			restFailureText(
				new Error(
					'[openstation] files REST 403: openstation_files_forbidden You are not allowed to edit this post.',
				),
			),
		).toBe( 'You are not allowed to edit this post.' );
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
