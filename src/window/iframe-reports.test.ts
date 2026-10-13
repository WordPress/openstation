/**
 * `relayIframeReport()` — the one relay both iframe windows and
 * admin pages embedded in native windows use for the chromeless
 * bridge's `os-iframe-error` / `os-iframe-network` reports.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addAction, HOOKS } from '../hooks';
import { clearHooksStub, installHooksStub } from '../../tests/vitest/helpers/hooks-stub';
import { relayIframeReport } from './iframe-reports';

beforeEach( () => installHooksStub() );
afterEach( () => clearHooksStub() );

describe( 'relayIframeReport', () => {
	test( 'normalises a network report and keeps headers only when present', () => {
		const seen: unknown[] = [];
		addAction( HOOKS.IFRAME_NETWORK_COMPLETED, 'test', ( p: unknown ) => seen.push( p ) );

		expect( relayIframeReport( 'w1', { type: 'os-iframe-network', status: 'nope', failed: 1 } ) ).toBe( true );
		expect( relayIframeReport( 'w1', { type: 'os-iframe-network', url: '/a', status: 503, duration: 12, requestHeaders: { a: '1' } } ) ).toBe( true );

		expect( seen ).toEqual( [
			{ windowId: 'w1', method: 'GET', url: '', status: 0, duration: 0, failed: true },
			{ windowId: 'w1', method: 'GET', url: '/a', status: 503, duration: 12, failed: false, requestHeaders: { a: '1' } },
		] );
	} );

	test( 'normalises an error report', () => {
		const seen: unknown[] = [];
		addAction( HOOKS.IFRAME_ERROR, 'test', ( p: unknown ) => seen.push( p ) );

		relayIframeReport( 'w2', { type: 'os-iframe-error', kind: 'unhandledrejection', message: 'boom', lineno: 'x' } );

		expect( seen ).toEqual( [
			{ windowId: 'w2', kind: 'unhandledrejection', message: 'boom', filename: null, lineno: null, colno: null, stack: null },
		] );
	} );

	test( 'anything else is not a report', () => {
		expect( relayIframeReport( 'w3', { type: 'os-content-identity' } ) ).toBe( false );
		expect( relayIframeReport( 'w3', null ) ).toBe( false );
		expect( relayIframeReport( 'w3', 'os-iframe-network' ) ).toBe( false );
	} );
} );
