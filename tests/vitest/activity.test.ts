/**
 * Unit tests for the cross-plugin activity channel API.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { activity } from '../../src/activity';
import { addFilter, doAction, removeFilter } from '../../src/hooks';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

describe( 'wp.os.activity', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'publish + subscribe round-trips a payload', () => {
		const cb = vi.fn();
		const off = activity.subscribe( 'plugin-x/something', cb );
		activity.publish( 'plugin-x/something', { id: 7, label: 'hi' } );
		expect( cb ).toHaveBeenCalledWith( { id: 7, label: 'hi' } );
		off();
	} );

	test( 'unsubscribe stops further notifications', () => {
		const cb = vi.fn();
		const off = activity.subscribe( 'plugin-x/another', cb );
		off();
		activity.publish( 'plugin-x/another', null );
		expect( cb ).not.toHaveBeenCalled();
	} );

	test( 'unsubscribing twice is a safe no-op', () => {
		const off = activity.subscribe( 'plugin-x/idempotent', () => {} );
		off();
		expect( () => off() ).not.toThrow();
	} );

	test( 'multiple subscribers receive the same publication', () => {
		const a = vi.fn();
		const b = vi.fn();
		activity.subscribe( 'plugin-x/multi', a );
		activity.subscribe( 'plugin-x/multi', b );
		activity.publish( 'plugin-x/multi', 42 );
		expect( a ).toHaveBeenCalledWith( 42 );
		expect( b ).toHaveBeenCalledWith( 42 );
	} );

	test( 'channels are namespaced — different keys don\'t collide', () => {
		const a = vi.fn();
		const b = vi.fn();
		activity.subscribe( 'plugin-a/foo', a );
		activity.subscribe( 'plugin-b/foo', b );
		activity.publish( 'plugin-a/foo', 'first' );
		expect( a ).toHaveBeenCalledWith( 'first' );
		expect( b ).not.toHaveBeenCalled();
	} );

	// A plugin reaching the bus through raw `wp.hooks` has to spell
	// the hook name the way the channel maps onto it.
	test( 'filter mutates the value through registered filters', () => {
		addFilter(
			'os.activity.plugin-x.redact',
			'plugin-x-test',
			( v: unknown ) => {
				return ( v as string ).replace( /secret/g, '***' );
			},
		);
		const out = activity.filter(
			'plugin-x/redact',
			'this is a secret',
		);
		expect( out ).toBe( 'this is a ***' );
		removeFilter( 'os.activity.plugin-x.redact', 'plugin-x-test' );
	} );

	test( 'a channel maps onto a hook name @wordpress/hooks accepts', () => {
		// The regression that made every `subscribe()` a silent no-op
		// in a browser: `addAction` bails on an invalid name, and
		// `doAction` still "succeeds" against zero handlers.
		const cb = vi.fn();
		activity.subscribe( 'desktop-mode/game-score-recorded', cb );
		// Reaching the same channel by its raw hook name proves the
		// mapping, not just that publish/subscribe agree with itself.
		doAction( 'os.activity.desktop-mode.game-score-recorded', {
			game: 'inkfall',
		} );
		expect( cb ).toHaveBeenCalledWith( { game: 'inkfall' } );
	} );

	test( 'filter falls through when no filters registered', () => {
		const out = activity.filter( 'plugin-x/passthrough', 99 );
		expect( out ).toBe( 99 );
	} );
} );
