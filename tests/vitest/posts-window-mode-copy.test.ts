/**
 * The Posts and Pages windows share one renderer, so every string it
 * builds has to pick its noun off `config.mode` — otherwise the Pages
 * window tells the user it is about to trash "1 post(s)". The PHP
 * templates already do this for the markup they own (search
 * placeholder, empty state); these are the strings the bundle owns.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createPostsWindowClient,
	type PostsWindowConfig,
} from '../../src/posts-window/rest';
import type { BulkAction } from '../../src/posts-window/types';
import { renderPostsWindow } from '../../src/posts-window/index';

const POSTS_URL = 'http://example.test/wp-json/wp/v2/posts';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	interface Window {
		openStationWindowConfig?: Record< string, unknown >;
	}
}

function installConfig( windowId: string, mode: 'posts' | 'pages' ): void {
	const cfg: PostsWindowConfig = {
		restRoot: 'http://example.test/wp-json/',
		restNonce: 'nonce-1',
		postsUrl: POSTS_URL,
		editPostUrlBase: 'http://example.test/wp-admin/post.php',
		newPostUrl: 'http://example.test/wp-admin/post-new.php',
		usersUrl: 'http://example.test/wp-json/wp/v2/users',
		currentUserId: 1,
		defaultPerPage: 20,
		mode,
		queryArgs: {},
	};
	window.openStationWindowConfig = window.openStationWindowConfig ?? {};
	window.openStationWindowConfig[ windowId ] = cfg;
}

/**
 * Minimal stand-in for the PHP template — only the hooks the renderer
 * reaches for in this test.
 */
function buildBody(): HTMLElement {
	const body = document.createElement( 'div' );
	body.innerHTML = `
		<div data-os-posts-root>
			<os-table data-os-posts-table selectable="multi"></os-table>
			<span data-os-posts-bulk-actions></span>
			<span data-os-posts-page-indicator></span>
		</div>
	`;
	document.body.appendChild( body );
	return body;
}

/**
 * Capture the shipped defaults through the same filter plugins use —
 * `defaultBulkActions()` is module-private on purpose.
 */
function captureBulkActions(): () => BulkAction[] {
	let captured: BulkAction[] = [];
	( window as unknown as { wp: Record< string, unknown > } ).wp = {
		hooks: {
			applyFilters: ( _name: string, value: unknown ) => {
				if ( Array.isArray( value ) && value[ 0 ]?.id === 'trash' ) {
					captured = value as BulkAction[];
				}
				return value;
			},
		},
	};
	return () => captured;
}

async function render(
	windowId: string,
	mode: 'posts' | 'pages',
	rows: unknown[],
): Promise< { body: HTMLElement; bulkActions: () => BulkAction[] } > {
	installConfig( windowId, mode );
	const bulkActions = captureBulkActions();
	// A fresh Response per call — the renderer fires several fetches
	// and a single instance's body can only be read once.
	vi.spyOn( global, 'fetch' as never ).mockImplementation( ( () =>
		Promise.resolve(
			new Response( JSON.stringify( rows ), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Total': String( rows.length ),
					'X-WP-TotalPages': rows.length ? '1' : '0',
				},
			} ),
		) ) as never );
	const body = buildBody();
	await renderPostsWindow( body, createPostsWindowClient( windowId ) );
	return { body, bulkActions };
}

const row = ( id: number ) => ( {
	id,
	title: { rendered: `Row ${ id }` },
	status: 'publish',
	date_gmt: '2026-01-01T00:00:00',
	author: 1,
} );

beforeEach( () => {
	document.body.replaceChildren();
} );

afterEach( () => {
	delete window.openStationWindowConfig;
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.restoreAllMocks();
} );

/** The shipped `confirm` is a builder — resolve it at a given count. */
function confirmAt( action: BulkAction, count: number ): string {
	const { confirm } = action;
	if ( typeof confirm !== 'function' ) {
		throw new Error( 'expected the trash confirm to be a builder' );
	}
	return confirm( count );
}

describe( 'bulk-trash confirmation', () => {
	test( 'posts mode says post, and pluralizes', async () => {
		const { bulkActions } = await render(
			'desktop-mode-posts',
			'posts',
			[ row( 1 ) ],
		);
		expect( confirmAt( bulkActions()[ 0 ], 1 ) ).toBe(
			'Move 1 post to the trash?',
		);
		expect( confirmAt( bulkActions()[ 0 ], 3 ) ).toBe(
			'Move 3 posts to the trash?',
		);
	} );

	test( 'pages mode says page, and pluralizes', async () => {
		const { bulkActions } = await render(
			'desktop-mode-pages',
			'pages',
			[ row( 1 ) ],
		);
		expect( confirmAt( bulkActions()[ 0 ], 1 ) ).toBe(
			'Move 1 page to the trash?',
		);
		expect( confirmAt( bulkActions()[ 0 ], 3 ) ).toBe(
			'Move 3 pages to the trash?',
		);
	} );
} );

describe( 'pager indicator', () => {
	test( 'posts mode counts posts', async () => {
		const { body } = await render(
			'desktop-mode-posts',
			'posts',
			[ row( 1 ), row( 2 ) ],
		);
		expect(
			body.querySelector( '[data-os-posts-page-indicator]' )?.textContent,
		).toBe( 'Page 1 of 1 · 2 posts' );
	} );

	test( 'pages mode counts pages', async () => {
		const { body } = await render(
			'desktop-mode-pages',
			'pages',
			[ row( 1 ), row( 2 ) ],
		);
		expect(
			body.querySelector( '[data-os-posts-page-indicator]' )?.textContent,
		).toBe( 'Page 1 of 1 · 2 pages' );
	} );

	test( 'pages mode empty state counts pages', async () => {
		const { body } = await render( 'desktop-mode-pages', 'pages', [] );
		expect(
			body.querySelector( '[data-os-posts-page-indicator]' )?.textContent,
		).toBe( 'No pages' );
	} );
} );
