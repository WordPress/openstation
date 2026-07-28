/**
 * Regression guard for the native Comments window inline reply/edit.
 *
 * The bug: `<wpd-table>` renders its rows inside an (open) shadow DOM,
 * but openReplyFor()/openEditFor() located the target row with a
 * light-DOM `tableHost.querySelector('tr[data-row-id]')`. That query
 * can't cross the shadow boundary, so it returned null, `tr.after()`
 * was a no-op, and the editor was appended to a DETACHED node — clicking
 * Reply/Edit did nothing, no editor ever appeared. The window is opt-in
 * and off by default, so this shipped broken and unnoticed.
 *
 * These tests assert the observable contract that broke: after opening
 * a reply/edit, the mounted editor is CONNECTED to the document (anchored
 * under the panel body), independent of where the rows live.
 */
import { describe, expect, test, afterEach } from 'vitest';
import { openReplyFor, openEditFor } from '../../src/comments-window/index';
import type { CommentRow, CommentsConfig } from '../../src/comments-window/index';

type State = Parameters< typeof openReplyFor >[ 0 ];

function makeRow( over: Partial< CommentRow > = {} ): CommentRow {
	return {
		id: 1,
		post: 5,
		author_name: 'Marta Ruiz',
		content: { raw: 'Original text', rendered: 'Original text' },
		desktop_mode_can_edit: true,
		...over,
	} as unknown as CommentRow;
}

function makeState( rows: CommentRow[], tableHost: HTMLElement ): State {
	return {
		tab: 'all',
		page: 1,
		perPage: 20,
		total: rows.length,
		totalPages: 1,
		search: '',
		rows,
		root: tableHost,
		tableHost,
		repliesByParent: new Map(),
		openReplies: new Set(),
	} as unknown as State;
}

const cfg = { replyEditor: 'plain' } as unknown as CommentsConfig;

describe( 'Comments window — inline reply/edit anchoring', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'opening a reply mounts the editor connected to the document', () => {
		const tableHost = document.createElement( 'div' );
		document.body.appendChild( tableHost );

		openReplyFor( makeState( [ makeRow() ], tableHost ), 1, cfg );

		const input = document.querySelector( '.desktop-mode-comments__reply-input' );
		expect( input ).not.toBeNull();
		// The regression: the editor used to land in a detached node.
		expect( input?.isConnected ).toBe( true );

		const host = document.querySelector( '.desktop-mode-comments__inline-host' );
		expect( host?.parentElement ).toBe( tableHost );
	} );

	test( 'opening an edit mounts the editor connected to the document', () => {
		const tableHost = document.createElement( 'div' );
		document.body.appendChild( tableHost );

		openEditFor(
			makeState( [ makeRow() ], tableHost ),
			1,
			cfg,
			async () => {},
		);

		const input = document.querySelector( '.desktop-mode-comments__reply-input' );
		expect( input ).not.toBeNull();
		expect( input?.isConnected ).toBe( true );
	} );

	test( 'only one inline editor is open at a time', () => {
		const tableHost = document.createElement( 'div' );
		document.body.appendChild( tableHost );
		const state = makeState( [ makeRow(), makeRow( { id: 2 } ) ], tableHost );

		openReplyFor( state, 1, cfg );
		openReplyFor( state, 2, cfg );

		expect(
			document.querySelectorAll( '.desktop-mode-comments__inline-host' ),
		).toHaveLength( 1 );
	} );
} );
