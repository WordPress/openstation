/**
 * Preview actions — the one pipeline across every Explorer surface.
 *
 * Server descriptors (`openstation_my_wordpress_preview_actions`)
 * must render in the post-kind right pane and the tile context menu,
 * not just the media pane; `sections` must match the post type slug
 * as well as the section id; and `onSelect` must receive the selected
 * entity.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { addFilter, removeFilter } from '../../src/hooks';
import {
	buildPreviewActionContext,
	buildPreviewActionRow,
	previewActionsToMenuOptions,
	resolvePreviewActions,
} from '../../src/my-wordpress/preview-actions';
import type {
	MyWordPressEntity,
	PreviewAction,
	PreviewActionContext,
} from '../../src/my-wordpress/types';

const WINDOW_ID = 'desktop-mode-my-wordpress';
const NS = 'test/preview-actions';

interface NativeWindowsGlobal {
	openStationNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	openStationWindowConfig?: Record< string, unknown >;
}

const ENTITY: MyWordPressEntity = {
	id: 'cpt-atf-form',
	label: 'Forms',
	icon: 'dashicons-feedback',
	restPath: 'wp/v2/atf-form',
	kind: 'post',
	post_type: 'atf-form',
};

const DETAIL: Record< string, unknown > = {
	id: 7,
	title: { rendered: 'Contact form' },
	content: { rendered: '<p>A form.</p>' },
	excerpt: { rendered: '' },
	date: '2026-01-01T00:00:00',
	status: 'publish',
	link: 'http://example.test/?p=7',
	featured_media: 0,
};

function installConfig( previewActions: PreviewAction[] ): void {
	( window as unknown as NativeWindowsGlobal ).openStationWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'http://example.test/wp-json/',
			restNonce: 'nonce',
			editPostUrlBase: 'http://example.test/wp-admin/post.php',
			editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
			siteName: 'Example',
			entities: [ ENTITY ],
			groups: [],
			perPage: 24,
			mediaPerPage: 48,
			previewActions,
		},
	};
}

describe( 'my-wordpress — preview actions across kinds', () => {
	beforeEach( () => {
		installHooksStub();
		installConfig( [] );
	} );

	afterEach( () => {
		removeFilter( 'os.my-wordpress.preview-actions', NS );
		removeFilter( 'os.my-wordpress.tile-context-menu', NS );
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'sections match the post type slug and the wildcard, not just the id', () => {
		const actions: PreviewAction[] = [
			{ id: 'by-id', label: 'A', sections: [ 'cpt-atf-form' ] },
			{ id: 'by-post-type', label: 'B', sections: [ 'atf-form' ] },
			{ id: 'wildcard', label: 'C', sections: [ '*' ] },
			{ id: 'other', label: 'D', sections: [ 'media' ] },
		];
		const ctx = buildPreviewActionContext( ENTITY, DETAIL, {
			surface: 'pane',
		} );
		const ids = resolvePreviewActions( actions, ctx ).map( ( a ) => a.id );
		expect( ids ).toEqual( [ 'by-id', 'by-post-type', 'wildcard' ] );
	} );

	test( 'buildPreviewActionContext carries the entity and the item', () => {
		const ctx = buildPreviewActionContext( ENTITY, DETAIL, {
			surface: 'context-menu',
		} );
		expect( ctx.entityId ).toBe( 'cpt-atf-form' );
		expect( ctx.kind ).toBe( 'post' );
		expect( ctx.postType ).toBe( 'atf-form' );
		expect( ctx.item ).toBe( DETAIL );
		expect( ctx.itemId ).toBe( 7 );
		expect( ctx.surface ).toBe( 'context-menu' );
	} );

	test( 'buildPreviewActionRow resolves config descriptors for a section', () => {
		installConfig( [
			{ id: 'atf/open-builder', label: 'Open in builder', sections: [ 'atf-form' ] },
		] );
		const row = buildPreviewActionRow( ENTITY, DETAIL );
		expect( row ).not.toBeNull();
		expect(
			row!.querySelector( '[data-action-id="atf/open-builder"]' ),
		).not.toBeNull();

		// A section the descriptor doesn't name gets no row at all.
		const other: MyWordPressEntity = {
			id: 'posts',
			label: 'Posts',
			icon: 'dashicons-admin-post',
			restPath: 'wp/v2/posts',
			kind: 'post',
			post_type: 'post',
		};
		expect( buildPreviewActionRow( other, DETAIL ) ).toBeNull();
	} );

	test( 'menu options wrap onSelect with the ctx-carrying handler', () => {
		const onSelect = vi.fn();
		installConfig( [
			{ id: 'atf/open-builder', label: 'Open in builder', sections: [ 'atf-form' ] },
		] );
		addFilter(
			'os.my-wordpress.preview-actions',
			NS,
			( actions: PreviewAction[] ) =>
				actions.map( ( a ) => ( { ...a, onSelect } ) ),
		);
		const options = previewActionsToMenuOptions( ENTITY, DETAIL );
		expect( options ).toHaveLength( 1 );
		expect( options[ 0 ].id ).toBe( 'atf/open-builder' );
		expect( options[ 0 ].sort ).toBe( 50 );
		// No icon declared — menu entries need one, so a default fills in.
		expect( options[ 0 ].icon ).toBe( 'dashicons-admin-generic' );

		options[ 0 ].onSelect();
		expect( onSelect ).toHaveBeenCalledTimes( 1 );
		const ctx = onSelect.mock.calls[ 0 ][ 0 ] as PreviewActionContext;
		expect( ctx.surface ).toBe( 'context-menu' );
		expect( ctx.itemId ).toBe( 7 );
		expect( ctx.item ).toBe( DETAIL );
	} );

	test( 'isVisible( ctx ) === false drops the entry from menus', () => {
		installConfig( [
			{ id: 'shown', label: 'Shown', sections: [ '*' ] },
		] );
		addFilter(
			'os.my-wordpress.preview-actions',
			NS,
			( actions: PreviewAction[] ) =>
				actions.map( ( a ) => ( { ...a, isVisible: () => false } ) ),
		);
		expect( previewActionsToMenuOptions( ENTITY, DETAIL ) ).toHaveLength( 0 );
	} );

	test( 'MIME-scoped descriptors stay out of post-kind contexts', () => {
		const actions: PreviewAction[] = [
			{ id: 'img-only', label: 'Compress', mime: '^image/', sections: [ '*' ] },
		];
		const ctx = buildPreviewActionContext( ENTITY, DETAIL, {
			surface: 'pane',
		} );
		expect( resolvePreviewActions( actions, ctx ) ).toHaveLength( 0 );
	} );
} );

describe( 'my-wordpress — post pane renders preview actions', () => {
	beforeEach( async () => {
		installHooksStub();
		installConfig( [
			{
				id: 'atf/open-builder',
				label: 'Open in builder',
				icon: 'dashicons-feedback',
				sections: [ 'atf-form' ],
			},
		] );
		vi.stubGlobal(
			'fetch',
			vi.fn( ( input: RequestInfo ) => {
				const url = String( input );
				const body = /\/atf-form\/7\b/.test( url )
					? JSON.stringify( DETAIL )
					: JSON.stringify( [ DETAIL ] );
				return Promise.resolve(
					new Response( body, {
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Total': '1',
							'X-WP-TotalPages': '1',
						},
					} ),
				);
			} ),
		);
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		removeFilter( 'os.my-wordpress.preview-actions', NS );
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	function mount(): HTMLElement {
		const cb = ( window as unknown as NativeWindowsGlobal )
			.openStationNativeWindows?.[ WINDOW_ID ];
		if ( typeof cb !== 'function' ) {
			throw new Error( 'render callback not registered' );
		}
		const body = document.createElement( 'div' );
		body.className = 'os-window__body';
		body.innerHTML = `
			<div class="desktop-mode-my-wordpress" data-os-my-wordpress-root>
				<header data-os-my-wordpress-breadcrumbs></header>
				<div class="os-my-wordpress__body" data-os-my-wordpress-body>
					<div class="os-my-wordpress__loading" data-os-my-wordpress-loading hidden></div>
				</div>
				<div class="os-folder-status-bar" data-os-my-wordpress-status></div>
			</div>
		`;
		document.body.appendChild( body );
		cb( body );
		return body;
	}

	function dblclickTile( body: HTMLElement, label: string ): void {
		const tile = [
			...body.querySelectorAll< HTMLElement >( 'os-tile' ),
		].find( ( t ) =>
			(
				t.querySelector( '.os-file-tile__label' )?.textContent ?? ''
			).startsWith( label ),
		);
		if ( ! tile ) {
			throw new Error( `no tile labelled ${ label }` );
		}
		tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
	}

	test( 'the pane shows the descriptor button and onSelect gets the entity', async () => {
		const onSelect = vi.fn();
		addFilter(
			'os.my-wordpress.preview-actions',
			NS,
			( actions: PreviewAction[] ) =>
				actions.map( ( a ) =>
					a.id === 'atf/open-builder' ? { ...a, onSelect } : a,
				),
		);

		const body = mount();
		dblclickTile( body, 'Forms' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );
		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		let btn: HTMLElement | null = null;
		await vi.waitFor( () => {
			btn = body.querySelector< HTMLElement >(
				'[data-action-id="atf/open-builder"]',
			);
			if ( ! btn ) {
				throw new Error( 'descriptor button not painted' );
			}
		} );

		// Rendered inside the article footer, after the built-ins.
		const footer = ( btn as unknown as HTMLElement ).closest(
			'.os-my-wordpress__article-footer',
		);
		expect( footer ).not.toBeNull();

		( btn as unknown as HTMLElement ).dispatchEvent(
			new Event( 'click', { bubbles: true } ),
		);
		expect( onSelect ).toHaveBeenCalledTimes( 1 );
		const ctx = onSelect.mock.calls[ 0 ][ 0 ] as PreviewActionContext;
		expect( ctx.entityId ).toBe( 'cpt-atf-form' );
		expect( ctx.kind ).toBe( 'post' );
		expect( ctx.postType ).toBe( 'atf-form' );
		expect( ctx.surface ).toBe( 'pane' );
		expect( ctx.itemId ).toBe( 7 );
		expect( ( ctx.item as { id: number } ).id ).toBe( 7 );
	} );
} );
