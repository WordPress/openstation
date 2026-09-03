/**
 * Comments — the client half: the pure helpers and renders of the
 * view into jsdom (tabs and counts, the rail, the scope banner, the
 * conversation, the composer, the phone pane stamp).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext, renderedText } from '../../src/app-runtime/testing';
import app, {
	buildTree,
	freshUi,
	normalizeStatus,
	snippet,
	statusLabel,
	statusTone,
	type AppData,
	type AppState,
	type CommentRow,
	type UiState,
} from './comments.os';

function row( over: Partial< CommentRow > = {} ): CommentRow {
	return {
		id: 1,
		post: 10,
		parent: 0,
		author: 0,
		author_name: 'Alice',
		author_avatar_urls: {},
		date_gmt: '2026-01-01 10:00:00',
		content: { rendered: '<p>Hello <b>there</b></p>' },
		status: 'hold',
		openstation_post_title: 'A post &amp; more',
		openstation_post_link: 'https://example.test/a-post',
		openstation_can_edit: true,
		openstation_can_moderate: true,
		openstation_replies_count: 0,
		...over,
	};
}

function data( over: Partial< AppData > = {}, items: CommentRow[] = [ row() ] ): AppData {
	return {
		rail: { items, total: items.length, pages: 1, page: 1, perPage: 20, error: '' },
		railKey: 'pending|||0',
		thread: null,
		counts: { pending: 3, approved: 5, spam: 1, trash: 2, total: 11 },
		...over,
	};
}

function mount(
	state: Partial< AppState > = {},
	payload: AppData = data(),
	extra: Record< string, unknown > = { canModerate: true, currentUserId: 7 },
) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( {
		state: { tab: 'pending', search: '', page: 1, perPage: 20, post: 0, selected: 0, gen: 0, ...state },
		data: payload,
		root,
		extra,
	} );
	ctx.repaint = () => app.render( ctx );
	ctx.dispatch = vi.fn( async () => true );
	app.render( ctx );
	return { root, ctx, ui: ctx.ui( freshUi ) as UiState };
}

beforeEach( () => {
	document.body.innerHTML = '';
} );

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'helpers', () => {
	it( 'normalizes the status vocabulary', () => {
		expect( normalizeStatus( row( { status: 'approve' } ) ) ).toBe( 'approved' );
		expect( normalizeStatus( row( { status: '1' } ) ) ).toBe( 'approved' );
		expect( normalizeStatus( row( { status: 'hold' } ) ) ).toBe( 'hold' );
		expect( normalizeStatus( row( { status: '0' } ) ) ).toBe( 'hold' );
		expect( normalizeStatus( row( { status: 'spam' } ) ) ).toBe( 'spam' );
		expect( statusLabel( 'hold' ) ).toBe( 'Pending' );
		expect( statusTone( 'spam' ) ).toBe( 'danger' );
	} );

	it( 'flattens a comment body into a one-line snippet', () => {
		expect( snippet( row( { content: { rendered: '<p>Hello\n  <b>there</b> &amp; you</p>' } } ) ) ).toBe( 'Hello there & you' );
	} );

	it( 'groups thread rows by parent', () => {
		const tree = buildTree( [ row( { id: 1 } ), row( { id: 2, parent: 1 } ), row( { id: 3, parent: 1 } ), row( { id: 4, parent: 2 } ) ] );
		expect( tree.get( 0 )?.map( ( r ) => r.id ) ).toEqual( [ 1 ] );
		expect( tree.get( 1 )?.map( ( r ) => r.id ) ).toEqual( [ 2, 3 ] );
		expect( tree.get( 2 )?.map( ( r ) => r.id ) ).toEqual( [ 4 ] );
	} );
} );

describe( 'tabs', () => {
	it( 'paints the five tabs with counts, Mine bare, and a picker with the same rows', () => {
		const { root } = mount();
		const tabs = Array.from( root.querySelectorAll( 'os-tab' ) );
		expect( tabs.map( ( t ) => t.getAttribute( 'value' ) ) ).toEqual( [ 'pending', 'all', 'spam', 'trash', 'mine' ] );
		expect( renderedText( tabs[ 0 ] ) ).toContain( '3' );
		expect( renderedText( tabs[ 1 ] ) ).toContain( '8' );
		expect( tabs[ 4 ].querySelector( 'os-badge' ) ).toBeNull();
		const strip = root.querySelector( 'os-tabs' );
		expect( strip?.getAttribute( 'os-bind' ) ).toBe( 'tab' );
		expect( strip?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( strip?.getAttribute( 'value' ) ).toBe( 'pending' );
		const picker = root.querySelector( 'os-select[data-os-comments-tabselect]' ) as HTMLElement & { items?: Array< { label: string } > };
		expect( picker.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( picker.items?.[ 0 ].label ).toBe( 'Pending (3)' );
		expect( picker.items?.[ 4 ].label ).toBe( 'Mine' );
	} );

	it( 'a tab change puts a narrow window back on the rail', () => {
		const { root, ui } = mount( { selected: 1 } );
		ui.pane = 'convo';
		root.querySelector( 'os-tabs' )?.dispatchEvent( new CustomEvent( 'os-tab-change', { detail: { value: 'all' } } ) );
		expect( ui.pane ).toBe( 'rail' );
	} );
} );

describe( 'rail', () => {
	it( 'paints one button per conversation with author, snippet, post title and reply count', () => {
		const { root } = mount( { selected: 1 }, data( {}, [ row(), row( { id: 2, author_name: 'Bob', openstation_replies_count: 4 } ) ] ) );
		const items = Array.from( root.querySelectorAll( '.os-comments__thread' ) );
		expect( items ).toHaveLength( 2 );
		expect( renderedText( items[ 0 ] ) ).toContain( 'Alice' );
		expect( renderedText( items[ 0 ] ) ).toContain( 'Hello there' );
		expect( renderedText( items[ 0 ] ) ).toContain( 'A post & more' );
		expect( items[ 0 ].classList.contains( 'is-selected' ) ).toBe( true );
		expect( items[ 0 ].getAttribute( 'aria-current' ) ).toBe( 'true' );
		expect( items[ 1 ].hasAttribute( 'aria-current' ) ).toBe( false );
		expect( renderedText( items[ 1 ].querySelector( '.os-comments__reply-count' )! ) ).toContain( '4' );
		expect( root.querySelector( '.os-comments__search os-text-field' )?.getAttribute( 'os-action' ) ).toBe( 'filter' );
	} );

	it( 'a click selects the conversation and shows the pane; re-picking the open one is local', () => {
		const { root, ctx, ui } = mount( {}, data( {}, [ row(), row( { id: 2 } ) ] ) );
		( root.querySelectorAll( '.os-comments__thread' )[ 1 ] as HTMLElement ).click();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'select', { id: 2 } );
		expect( ui.pane ).toBe( 'convo' );
		const open = mount( { selected: 1 }, data( { thread: [ row() ] } ) );
		( open.root.querySelector( '.os-comments__thread' ) as HTMLElement ).click();
		expect( open.ctx.dispatch ).not.toHaveBeenCalled();
	} );

	it( 'shows the empty states: none, none on this post, could not load', () => {
		const heading = ( root: HTMLElement ): string =>
			root.querySelector( '.os-comments__list os-empty-state' )?.getAttribute( 'heading' ) ?? '';
		expect( heading( mount( {}, data( {}, [] ) ).root ) ).toBe( 'No conversations yet' );
		expect( heading( mount( { post: 10 }, data( {}, [] ) ).root ) ).toBe( 'Nothing on this post here' );
		const failed = mount( {}, data( { rail: { items: [], total: 0, pages: 1, page: 1, perPage: 20, error: 'nope' } }, [] ) );
		expect( heading( failed.root ) ).toBe( 'Could not load comments' );
		expect( failed.root.querySelector( '.os-comments__rail-filter' ) ).toBeNull();
	} );

	it( 'scoped to a post: the banner names it and Show all clears the scope', () => {
		const { root, ctx } = mount( { post: 10, tab: 'all' } );
		const banner = root.querySelector( '.os-comments__rail-filter' )!;
		expect( renderedText( banner ) ).toContain( 'On: A post & more' );
		( banner.querySelector( 'os-button' ) as HTMLElement ).click();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'filter', { post: 0 } );
	} );

	it( 'offers Load more only while the server reports another page, and accumulates pages', () => {
		const page1 = data( { rail: { items: [ row( { id: 1 } ) ], total: 2, pages: 2, page: 1, perPage: 1, error: '' } } );
		const { root, ctx } = mount( {}, page1 );
		const more = root.querySelector( '.os-comments__load-more os-button' ) as HTMLElement;
		expect( more ).not.toBeNull();
		more.click();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'page', { page: 2 } );
		( ctx as unknown as { data: AppData } ).data = data( { rail: { items: [ row( { id: 2 } ) ], total: 2, pages: 2, page: 2, perPage: 1, error: '' } } );
		app.render( ctx );
		expect( root.querySelectorAll( '.os-comments__thread' ) ).toHaveLength( 2 );
		expect( root.querySelector( '.os-comments__load-more' ) ).toBeNull();
	} );
} );

describe( 'conversation', () => {
	it( 'shows the placeholder — and the rail pane — when nothing is selected', () => {
		const { root } = mount( {}, data( {}, [] ) );
		expect( root.querySelector( '.os-comments__convo os-empty-state' )?.getAttribute( 'heading' ) ).toBe( 'No conversation selected' );
		expect( root.querySelector( '[data-os-comments-root]' )?.getAttribute( 'data-os-comments-pane' ) ).toBe( 'rail' );
	} );

	it( 'paints the head, the nested thread, the status chips and the composer', () => {
		const thread = [
			row( { id: 1, status: 'approve' } ),
			row( { id: 2, parent: 1, author: 7, author_name: 'Me', status: 'hold', content: { rendered: '<p>A reply</p>' } } ),
		];
		const { root } = mount( { selected: 1 }, data( { thread } ) );
		expect( renderedText( root.querySelector( '.os-comments__convo-kicker' )! ) ).toBe( 'In response to' );
		const link = root.querySelector< HTMLAnchorElement >( 'a.os-comments__convo-post--editable' )!;
		expect( link.getAttribute( 'href' ) ).toContain( 'post.php?post=10&action=edit' );
		expect( root.querySelector( '.os-comments__convo-link' )?.getAttribute( 'href' ) ).toBe( 'https://example.test/a-post' );
		const messages = root.querySelectorAll( '.os-comments__msg' );
		expect( messages ).toHaveLength( 2 );
		expect( root.querySelector( '.os-comments__nested .os-comments__msg' )?.getAttribute( 'data-id' ) ).toBe( '2' );
		expect( root.querySelector( '.os-comments__msg[data-id="1"] .os-comments__msg-text' )?.innerHTML ).toBe( '<p>Hello <b>there</b></p>' );
		expect( root.querySelector( '.os-comments__msg[data-id="2"] .os-comments__msg-you' ) ).not.toBeNull();
		expect( root.querySelector( '.os-comments__msg[data-id="2"] .os-comments__msg-status' ) ).not.toBeNull();
		expect( root.querySelector( '.os-comments__msg[data-id="1"] > .os-comments__msg-body > .os-comments__msg-head .os-comments__msg-status' ) ).toBeNull();
		const actions = Array.from( root.querySelectorAll( '.os-comments__msg[data-id="1"] > .os-comments__msg-body > .os-comments__msg-actions os-button' ) ).map( ( b ) => b.textContent?.trim() );
		expect( actions ).toEqual( [ 'Unapprove', 'Reply', 'Edit', 'Spam', 'Trash' ] );
		expect( renderedText( root.querySelector( '.os-comments__composer-to' )! ) ).toContain( 'Alice' );
	} );

	it( 'hides the composer for a viewer who cannot moderate, and the moderation verbs the row denies', () => {
		const { root } = mount( { selected: 1 }, data( { thread: [ row( { openstation_can_moderate: false, openstation_can_edit: false } ) ] } ), { canModerate: false } );
		expect( root.querySelector( '.os-comments__composer' )?.classList.contains( 'is-empty' ) ).toBe( true );
		expect( root.querySelectorAll( '.os-comments__msg-actions os-button' ) ).toHaveLength( 0 );
	} );

	it( 'a moderation verb dispatches with the row id; spam and trash ask first', () => {
		const { root, ctx } = mount( { selected: 1 }, data( { thread: [ row() ] } ) );
		const buttons = Array.from( root.querySelectorAll< HTMLElement >( '.os-comments__msg-actions os-button' ) );
		buttons[ 0 ].click();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'moderate', { ids: [ 1 ], action: 'approve' }, { confirm: null } );
		buttons[ 4 ].click();
		expect( ctx.dispatch ).toHaveBeenLastCalledWith(
			'moderate',
			{ ids: [ 1 ], action: 'trash' },
			{ confirm: expect.objectContaining( { danger: true, label: 'Move to trash' } ) },
		);
	} );

	it( 'Reply retargets the composer; Send dispatches the draft and Enter sends too', async () => {
		const thread = [ row( { id: 1 } ), row( { id: 2, parent: 1, author_name: 'Bob' } ) ];
		const { root, ctx, ui } = mount( { selected: 1 }, data( { thread } ) );
		const replyButtons = Array.from( root.querySelectorAll< HTMLElement >( '.os-comments__msg[data-id="2"] .os-comments__msg-actions os-button' ) );
		replyButtons[ 1 ].click();
		expect( ui.replyTo ).toBe( 2 );
		expect( renderedText( root.querySelector( '.os-comments__composer-to' )! ) ).toContain( 'Bob' );

		const textarea = root.querySelector( '.os-comments__composer os-textarea' )!;
		textarea.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 'Thanks!' } } ) );
		( root.querySelector( '.os-comments__composer-row os-button' ) as HTMLElement ).click();
		await Promise.resolve();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'reply', { parent: 2, content: 'Thanks!' } );

		textarea.dispatchEvent( new CustomEvent( 'os-submit', { detail: { value: 'Again' } } ) );
		await Promise.resolve();
		expect( ctx.dispatch ).toHaveBeenLastCalledWith( 'reply', { parent: 2, content: 'Again' } );
	} );

	it( 'an empty reply is a toast, not a request', () => {
		const { root, ctx } = mount( { selected: 1 }, data( { thread: [ row() ] } ) );
		const toast = vi.fn();
		ctx.host.toast = toast;
		( root.querySelector( '.os-comments__composer-row os-button' ) as HTMLElement ).click();
		expect( toast ).toHaveBeenCalledWith( { message: 'Reply is empty.' } );
		expect( ctx.dispatch ).not.toHaveBeenCalled();
	} );

	it( 'Edit opens the inline editor seeded with the text, Cancel closes it, Save dispatches', async () => {
		const { root, ctx, ui } = mount( { selected: 1 }, data( { thread: [ row( { content: { raw: 'Raw text', rendered: '<p>Raw text</p>' } } ) ] } ) );
		const edit = Array.from( root.querySelectorAll< HTMLElement >( '.os-comments__msg-actions os-button' ) )[ 2 ];
		edit.click();
		expect( ui.editing ).toBe( 1 );
		const editor = root.querySelector( '.os-comments__msg-body > os-textarea' )!;
		expect( editor.getAttribute( 'value' ) ).toBe( 'Raw text' );
		expect( ( root.querySelector( '.os-comments__msg-text' ) as HTMLElement ).hidden ).toBe( true );
		expect( root.querySelector( '.os-comments__msg-actions' )?.hasAttribute( 'hidden' ) ).toBe( true );

		const bar = root.querySelector( '.os-comments__edit-bar' )!;
		( bar.querySelectorAll( 'os-button' )[ 0 ] as HTMLElement ).click();
		expect( ui.editing ).toBe( 0 );
		expect( root.querySelector( '.os-comments__edit-bar' ) ).toBeNull();

		edit.click();
		root.querySelector( '.os-comments__msg-body > os-textarea' )!.dispatchEvent(
			new CustomEvent( 'os-input-change', { detail: { value: 'Edited' } } ),
		);
		( root.querySelector( '.os-comments__edit-bar' )!.querySelectorAll( 'os-button' )[ 1 ] as HTMLElement ).click();
		await Promise.resolve();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'edit', { id: 1, content: 'Edited' } );
	} );

	it( 'a change of conversation resets the composer', () => {
		const { ctx, ui } = mount( { selected: 1 }, data( { thread: [ row() ] }, [ row(), row( { id: 2 } ) ] ) );
		ui.draft = 'half-written';
		ui.replyTo = 1;
		( ctx as unknown as { state: AppState } ).state = { ...ctx.state, selected: 2 };
		app.render( ctx );
		expect( ui.draft ).toBe( '' );
		expect( ui.replyTo ).toBe( 0 );
	} );

	it( 'Back returns a narrow window to the rail', () => {
		const { root, ctx, ui } = mount( { selected: 1 }, data( { thread: [ row() ] } ) );
		ui.pane = 'convo';
		ctx.repaint();
		expect( root.querySelector( '[data-os-comments-root]' )?.getAttribute( 'data-os-comments-pane' ) ).toBe( 'convo' );
		( root.querySelector( '.os-comments__convo-back' ) as HTMLElement ).click();
		expect( ui.pane ).toBe( 'rail' );
		expect( root.querySelector( '[data-os-comments-root]' )?.getAttribute( 'data-os-comments-pane' ) ).toBe( 'rail' );
	} );
} );

describe( 'live region and identity', () => {
	it( 'the status node is the single polite live region', () => {
		const { root } = mount();
		const status = root.querySelector( '[data-os-comments-status]' )!;
		expect( status.getAttribute( 'role' ) ).toBe( 'status' );
		expect( status.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	it( 'a post scope announces the identity to the relations engine once, and a cleared scope clears it', () => {
		const set = vi.fn();
		( window as unknown as { wp?: unknown } ).wp = { os: { relations: { set } } };
		const win = document.createElement( 'div' );
		win.id = 'wp-window-desktop-mode-comments';
		document.body.appendChild( win );
		const root = document.createElement( 'div' );
		win.appendChild( root );
		const ctx = mockViewContext< AppState, AppData >( {
			state: { tab: 'all', search: '', page: 1, perPage: 20, post: 10, selected: 0, gen: 0 },
			data: data(),
			root,
			extra: {},
		} );
		app.render( ctx );
		app.render( ctx );
		expect( set ).toHaveBeenCalledTimes( 1 );
		expect( set ).toHaveBeenCalledWith( 'desktop-mode-comments', expect.objectContaining( { type: 'comment', id: 10, label: 'A post & more' } ) );
		( ctx as unknown as { state: AppState } ).state = { ...ctx.state, post: 0 };
		app.render( ctx );
		expect( set ).toHaveBeenLastCalledWith( 'desktop-mode-comments', null );
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );
} );
