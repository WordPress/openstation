/**
 * The chromeless bridge's editor save-watcher, run against a stubbed
 * `core/editor` store.
 *
 * After a block-editor save the watcher refetches the server-computed
 * content identity and re-announces it to the shell. Real saves always
 * refetch; autosaves only do when the post was new — that autosave is
 * the one that turns the auto-draft into a draft, and without the
 * refetch the window never learns the post exists (the Preview eye
 * stayed disabled until the window was reopened).
 *
 * @vitest-environment-options { "url": "http://localhost/wp-admin/post-new.php?openstation_chromeless=1" }
 */
import { describe, expect, test, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

/** Messages the bridge posted to the (stubbed) parent shell. */
let posted: Array< Record< string, unknown > > = [];

/** Mutable editor state the stubbed selectors read. */
const editorState = {
	saving: false,
	autosaving: false,
	isNew: true,
	succeeded: true,
	postId: 42,
};

const listeners: Array< () => void > = [];
const apiFetch = vi.fn();

/** Push the store into a state and notify subscribers, like a dispatch. */
function setEditorState( next: Partial< typeof editorState > ): void {
	Object.assign( editorState, next );
	listeners.forEach( ( fn ) => fn() );
}

/** Run one save from start to finish. */
async function runSave( {
	autosave,
	isNew,
}: {
	autosave: boolean;
	isNew: boolean;
} ): Promise< void > {
	setEditorState( { isNew, saving: true, autosaving: autosave } );
	// Saving the post is what makes it stop being new.
	setEditorState( { isNew: false, saving: false, autosaving: false } );
	// Let the apiFetch promise chain settle.
	await new Promise( ( r ) => setTimeout( r, 0 ) );
}

function identityMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-content-identity' );
}

function broadcastMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-broadcast' );
}

beforeAll( () => {
	// jsdom's `window.parent` IS `window`; the bridge bails out of a
	// top-level page, so stand in a parent shell.
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

	// eslint-disable-next-line no-eval -- exercise the emitted source.
	( 0, eval )(
		readFileSync( resolve( ROOT, 'src/chromeless-bridge.js' ), 'utf8' )
	);
	// The watcher wires itself on `load`.
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
