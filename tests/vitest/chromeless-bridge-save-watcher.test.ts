/**
 * @vitest-environment-options { "url": "http://localhost/wp-admin/post-new.php?openstation_chromeless=1" }
 */
import { describe, expect, test, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

let posted: Array< Record< string, unknown > > = [];

const editorState = {
	saving: false,
	autosaving: false,
	isNew: true,
	succeeded: true,
	postId: 42,
};

const listeners: Array< () => void > = [];
const apiFetch = vi.fn();

function setEditorState( next: Partial< typeof editorState > ): void {
	Object.assign( editorState, next );
	listeners.forEach( ( fn ) => fn() );
}

async function runSave( {
	autosave,
	isNew,
}: {
	autosave: boolean;
	isNew: boolean;
} ): Promise< void > {
	setEditorState( { isNew, saving: true, autosaving: autosave } );
	setEditorState( { isNew: false, saving: false, autosaving: false } );
	await new Promise( ( r ) => setTimeout( r, 0 ) );
}

function identityMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-content-identity' );
}

function broadcastMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-broadcast' );
}

beforeAll( () => {
	Object.defineProperty( window, 'parent', {
		value: {
			postMessage: ( data: Record< string, unknown > ) => {
				posted.push( data );
			},
		},
		configurable: true,
	} );

	(
		window as unknown as { __osChromelessData: Record< string, unknown > }
	).__osChromelessData = {
		_menuPayload: null,
		_menuSig: null,
		_identity: null,
		_softReload: [],
	};
	(
		window as unknown as { __openStationScreenMetaInstalled: boolean }
	).__openStationScreenMetaInstalled = true;

	const editor = {
		isSavingPost: () => editorState.saving,
		isAutosavingPost: () => editorState.autosaving,
		isEditedPostNew: () => editorState.isNew,
		didPostSaveRequestSucceed: () => editorState.succeeded,
		getCurrentPostId: () => editorState.postId,
		getCurrentPostType: () => 'post',
	};
	( window as unknown as { wp: unknown } ).wp = {
		data: {
			select: ( store: string ) =>
				store === 'core/editor' ? editor : null,
			subscribe: ( fn: () => void ) => {
				listeners.push( fn );
				return () => undefined;
			},
		},
		apiFetch,
	};

	// eslint-disable-next-line no-eval
	( 0, eval )(
		readFileSync( resolve( ROOT, 'src/chromeless-bridge.js' ), 'utf8' )
	);
	window.dispatchEvent( new Event( 'load' ) );
} );

beforeEach( () => {
	posted = [];
	apiFetch.mockReset();
	apiFetch.mockResolvedValue( {
		identity: {
			type: 'post',
			id: 42,
			previewUrl: 'http://localhost/?p=42&preview=true',
		},
	} );
	Object.assign( editorState, {
		saving: false,
		autosaving: false,
		isNew: true,
		succeeded: true,
		postId: 42,
	} );
} );

describe( 'editor save-watcher', () => {
	test( 'an autosave of a NEW post re-announces the identity', async () => {
		await runSave( { autosave: true, isNew: true } );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/desktop-mode/v1/content-identity?post=42',
		} );
		expect( identityMessages() ).toEqual( [
			expect.objectContaining( {
				identity: expect.objectContaining( {
					id: 42,
					previewUrl: expect.any( String ),
				} ),
			} ),
		] );
		expect( broadcastMessages()[ 0 ] ).toMatchObject( {
			topic: 'os.post.changed',
			payload: { action: 'created', ids: [ 42 ] },
		} );
	} );

	test( 'an autosave of an existing post is ignored', async () => {
		await runSave( { autosave: true, isNew: false } );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( identityMessages() ).toHaveLength( 0 );
		expect( broadcastMessages() ).toHaveLength( 0 );
	} );

	test( 'a manual save re-announces the identity', async () => {
		await runSave( { autosave: false, isNew: false } );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( identityMessages() ).toHaveLength( 1 );
		expect( broadcastMessages()[ 0 ] ).toMatchObject( {
			payload: { action: 'updated' },
		} );
	} );

	test( 'a failed save announces nothing', async () => {
		editorState.succeeded = false;
		await runSave( { autosave: true, isNew: true } );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( posted ).toHaveLength( 0 );
	} );
} );
