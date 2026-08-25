/**
 * Entity-kind registry — register / look-up / unregister.
 */
import { describe, expect, test } from 'vitest';
import {
	registerEntityKind,
	getEntityRenderer,
	listRegisteredKinds,
} from '../../src/my-wordpress/kind-registry';

describe( 'my-wordpress kind-registry', () => {
	test( 'register + lookup', () => {
		const calls: string[] = [];
		const unregister = registerEntityKind( 'test-kind', ( _host, e ) => {
			calls.push( e.id );
		} );
		const renderer = getEntityRenderer( 'test-kind' );
		expect( renderer ).toBeTypeOf( 'function' );
		renderer?.(
			{
				body: document.createElement( 'div' ),
				route: { kind: 'list', entityId: 'foo' },
				navigate: () => {},
				addTeardown: () => {},
				previewActionRow: () => null,
			},
			{ id: 'foo', label: 'Foo', icon: 'dashicons-star-filled', restPath: 'wp/v2/foo', kind: 'test-kind' },
		);
		expect( calls ).toEqual( [ 'foo' ] );
		expect( listRegisteredKinds() ).toContain( 'test-kind' );
		unregister();
		expect( getEntityRenderer( 'test-kind' ) ).toBeUndefined();
	} );

	test( 'unregister only removes own renderer', () => {
		const u1 = registerEntityKind( 'a', () => {} );
		const renderer2 = () => {};
		registerEntityKind( 'a', renderer2 );
		u1(); // u1 is stale, should not delete renderer2.
		expect( getEntityRenderer( 'a' ) ).toBe( renderer2 );
	} );

	test( 'rejects non-string kind / non-function renderer', () => {
		expect( () => registerEntityKind( '', () => {} ) ).toThrow();
		expect( () =>
			// @ts-expect-error — intentionally bad argument.
			registerEntityKind( 'x', 'not a function' ),
		).toThrow();
	} );
} );
