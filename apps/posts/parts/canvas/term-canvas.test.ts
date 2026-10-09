import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { subscribeToContentChanges } from './term-canvas';

type Listener = ( payload: unknown ) => void;

let listeners: Map< string, Set< Listener > >;

function publish( topic: string, payload: unknown ): void {
	listeners.get( topic )?.forEach( ( cb ) => cb( payload ) );
}

beforeEach( () => {
	listeners = new Map();
	( window as unknown as { wp: unknown } ).wp = {
		os: {
			subscribe: ( topic: string, cb: Listener ) => {
				const set = listeners.get( topic ) ?? new Set();
				set.add( cb );
				listeners.set( topic, set );
				return () => set.delete( cb );
			},
		},
	};
} );

afterEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

test( 'a post recategorised in another window refreshes the canvas', () => {
	const onChange = vi.fn();
	subscribeToContentChanges( 'category', onChange );

	publish( 'os.post.changed', { source: 'editor', action: 'updated', ids: [ 12 ] } );

	expect( onChange ).toHaveBeenCalledOnce();
} );

test( 'term changes refresh only the canvas of their own taxonomy', () => {
	const onCategories = vi.fn();
	const onTags = vi.fn();
	subscribeToContentChanges( 'category', onCategories );
	subscribeToContentChanges( 'post_tag', onTags );

	publish( 'os.term.changed', { source: 'posts-window', taxonomy: 'category', action: 'created', id: 7 } );

	expect( onCategories ).toHaveBeenCalledOnce();
	expect( onTags ).not.toHaveBeenCalled();
} );

test( 'unsubscribing stops both channels', () => {
	const onChange = vi.fn();
	const off = subscribeToContentChanges( 'category', onChange );

	off();
	publish( 'os.post.changed', { ids: [ 1 ] } );
	publish( 'os.term.changed', { taxonomy: 'category' } );

	expect( onChange ).not.toHaveBeenCalled();
} );

test( 'without the shell bus it is inert', () => {
	delete ( window as unknown as { wp?: unknown } ).wp;

	expect( () => subscribeToContentChanges( 'category', vi.fn() )() ).not.toThrow();
} );
