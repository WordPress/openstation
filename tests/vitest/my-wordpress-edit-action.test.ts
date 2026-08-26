/**
 * `editAction` — a section chooses who edits its rows.
 *
 * A preview-action id replaces "Open in editor" at the pane button,
 * the menu's open entry, and tile double-click; `false` removes the
 * affordances (double-click falls back to the detail dossier, bulk
 * "Edit…" is suppressed). The detail request must also carry
 * `editUrl` + the section's `listFields`, so the pane's classic
 * button honors a row-supplied editor URL.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { addFilter, removeFilter } from '../../src/hooks';
import {
	buildPreviewActionRow,
	previewActionsToMenuOptions,
	resolveEditAction,
} from '../../src/my-wordpress/preview-actions';
import { entityBulkActions } from '../../src/my-wordpress/bulk-actions';
import { fetchEntityDetail } from '../../src/my-wordpress/rest';
import type {
	EntityListItem,
	MyWordPressEntity,
	PreviewAction,
} from '../../src/my-wordpress/types';

const WINDOW_ID = 'desktop-mode-my-wordpress';
const NS = 'test/edit-action';

interface NativeWindowsGlobal {
	openStationNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	openStationWindowConfig?: Record< string, unknown >;
}

function makeEntity(
	overrides: Partial< MyWordPressEntity > = {},
): MyWordPressEntity {
	return {
		id: 'cpt-atf-form',
		label: 'Forms',
		icon: 'dashicons-feedback',
		restPath: 'wp/v2/atf-form',
		kind: 'post',
		post_type: 'atf-form',
		...overrides,
	};
}

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

const BUILDER_ACTION: PreviewAction = {
	id: 'atf/open-builder',
	label: 'Open in form builder',
	icon: 'dashicons-feedback',
	sections: [ 'atf-form' ],
};

function installConfig(
	entity: MyWordPressEntity,
	previewActions: PreviewAction[],
): void {
	( window as unknown as NativeWindowsGlobal ).openStationWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'http://example.test/wp-json/',
			restNonce: 'nonce',
			editPostUrlBase: 'http://example.test/wp-admin/post.php',
			editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
			siteName: 'Example',
			entities: [ entity ],
			groups: [],
			perPage: 24,
			mediaPerPage: 48,
			previewActions,
		},
	};
}

/** Wire onSelect onto the builder action via the JS filter. */
function wireBuilder( onSelect: () => void ): void {
	addFilter(
		'os.my-wordpress.preview-actions',
		NS,
		( actions: PreviewAction[] ) =>
			actions.map( ( a ) =>
				a.id === 'atf/open-builder' ? { ...a, onSelect } : a,
			),
	);
}

describe( 'my-wordpress — editAction resolution', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		removeFilter( 'os.my-wordpress.preview-actions', NS );
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'undefined → classic; false → none', () => {
		installConfig( makeEntity(), [] );
		expect(
			resolveEditAction( makeEntity(), DETAIL, 'pane' ).mode,
		).toBe( 'classic' );
		expect(
			resolveEditAction(
				makeEntity( { editAction: false } ),
				DETAIL,
				'pane',
			).mode,
		).toBe( 'none' );
	} );

	test( 'a wired, visible named action resolves with its ctx', () => {
		const onSelect = vi.fn();
		installConfig(
			makeEntity( { editAction: 'atf/open-builder' } ),
			[ BUILDER_ACTION ],
		);
		wireBuilder( onSelect );
		const res = resolveEditAction(
			makeEntity( { editAction: 'atf/open-builder' } ),
			DETAIL,
			'dblclick',
		);
		expect( res.mode ).toBe( 'action' );
		if ( res.mode === 'action' ) {
			expect( res.action.label ).toBe( 'Open in form builder' );
			expect( res.ctx.surface ).toBe( 'dblclick' );
			expect( res.ctx.itemId ).toBe( 7 );
		}
	} );

	test( 'a named action that is missing or unwired hides editing', () => {
		// Not in the config (server dropped it — capability).
		installConfig(
			makeEntity( { editAction: 'atf/open-builder' } ),
			[],
		);
		expect(
			resolveEditAction(
				makeEntity( { editAction: 'atf/open-builder' } ),
				DETAIL,
				'pane',
			).mode,
		).toBe( 'none' );

		// Shipped, but no JS wired onSelect.
		installConfig(
			makeEntity( { editAction: 'atf/open-builder' } ),
			[ BUILDER_ACTION ],
		);
		expect(
			resolveEditAction(
				makeEntity( { editAction: 'atf/open-builder' } ),
				DETAIL,
				'pane',
			).mode,
		).toBe( 'none' );
	} );

	test( 'the named action leaves the generic row and menu', () => {
		const entity = makeEntity( { editAction: 'atf/open-builder' } );
		installConfig( entity, [
			BUILDER_ACTION,
			{ id: 'atf/export', label: 'Export', sections: [ 'atf-form' ] },
		] );
		wireBuilder( () => undefined );

		const row = buildPreviewActionRow( entity, DETAIL );
		expect( row ).not.toBeNull();
		expect(
			row!.querySelector( '[data-action-id="atf/open-builder"]' ),
		).toBeNull();
		expect(
			row!.querySelector( '[data-action-id="atf/export"]' ),
		).not.toBeNull();

		const menuIds = previewActionsToMenuOptions( entity, DETAIL ).map(
			( o ) => o.id,
		);
		expect( menuIds ).toEqual( [ 'atf/export' ] );
	} );

	test( 'bulk "Edit…" is suppressed only by editAction: false', () => {
		const item = DETAIL as unknown as EntityListItem;
		const onChanged = () => undefined;

		const withFalse = entityBulkActions(
			{ entity: makeEntity( { editAction: false } ), onChanged },
			item,
		).map( ( a ) => a.id );
		expect( withFalse ).not.toContain( 'bulk-edit' );

		const withAction = entityBulkActions(
			{
				entity: makeEntity( { editAction: 'atf/open-builder' } ),
				onChanged,
			},
			item,
		).map( ( a ) => a.id );
		expect( withAction ).toContain( 'bulk-edit' );

		const classic = entityBulkActions(
			{ entity: makeEntity(), onChanged },
			item,
		).map( ( a ) => a.id );
		expect( classic ).toContain( 'bulk-edit' );
	} );

	test( 'detail requests carry editUrl and the section listFields', async () => {
		const entity = makeEntity( { listFields: [ 'atfEntries' ] } );
		installConfig( entity, [] );
		const fetchSpy = vi.fn( () =>
			Promise.resolve(
				new Response( JSON.stringify( DETAIL ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		await fetchEntityDetail( entity, 7 );

		const url = String( fetchSpy.mock.calls[ 0 ][ 0 ] );
		const fields =
			new URL( url ).searchParams.get( '_fields' )?.split( ',' ) ?? [];
		expect( fields ).toContain( 'editUrl' );
		expect( fields ).toContain( 'atfEntries' );
	} );
} );

describe( 'my-wordpress — editAction in the mounted window', () => {
	beforeEach( () => {
		installHooksStub();
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
	} );

	afterEach( () => {
		removeFilter( 'os.my-wordpress.preview-actions', NS );
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	async function mountIntoForms(
		entity: MyWordPressEntity,
		previewActions: PreviewAction[],
	): Promise< HTMLElement > {
		installConfig( entity, previewActions );
		await import( '../../src/my-wordpress/index' );
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

		const sectionTile = [
			...body.querySelectorAll< HTMLElement >( 'os-tile' ),
		].find( ( t ) =>
			(
				t.querySelector( '.os-file-tile__label' )?.textContent ?? ''
			).startsWith( 'Forms' ),
		);
		if ( ! sectionTile ) {
			throw new Error( 'no Forms tile' );
		}
		sectionTile.dispatchEvent(
			new MouseEvent( 'dblclick', { bubbles: true } ),
		);
		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );
		return body;
	}

	test( 'the pane primary button is the declared editor', async () => {
		const onSelect = vi.fn();
		wireBuilder( onSelect );
		const body = await mountIntoForms(
			makeEntity( { editAction: 'atf/open-builder' } ),
			[ BUILDER_ACTION ],
		);

		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		let btn: HTMLElement | null = null;
		await vi.waitFor( () => {
			btn = body.querySelector< HTMLElement >(
				'.os-my-wordpress__article-footer [data-action-id="atf/open-builder"]',
			);
			if ( ! btn ) {
				throw new Error( 'editor button not painted' );
			}
		} );
		expect(
			( btn as unknown as HTMLElement ).getAttribute( 'variant' ),
		).toBe( 'primary' );
		expect( ( btn as unknown as HTMLElement ).textContent ).toBe(
			'Open in form builder',
		);

		( btn as unknown as HTMLElement ).dispatchEvent(
			new Event( 'click', { bubbles: true } ),
		);
		expect( onSelect ).toHaveBeenCalledTimes( 1 );
		expect( onSelect.mock.calls[ 0 ][ 0 ].surface ).toBe( 'pane' );

		// No classic "Open in editor" alongside it.
		const labels = [
			...body.querySelectorAll(
				'.os-my-wordpress__article-footer os-button',
			),
		].map( ( b ) => b.textContent );
		expect( labels ).not.toContain( 'Open in editor' );
	} );

	test( 'editAction: false hides the button and dblclick opens the dossier', async () => {
		const body = await mountIntoForms(
			makeEntity( { editAction: false } ),
			[],
		);

		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();
		await vi.waitFor( () => {
			if ( ! body.querySelector( '.os-my-wordpress__article-footer' ) ) {
				throw new Error( 'pane not painted' );
			}
		} );
		const labels = [
			...body.querySelectorAll(
				'.os-my-wordpress__article-footer os-button',
			),
		].map( ( b ) => b.textContent );
		expect( labels ).not.toContain( 'Open in editor' );

		// Double-click falls back to navigating INTO the entry (the
		// detail dossier renders sub-folder tiles) instead of opening
		// a classic-editor window that would 404.
		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )
			?.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
		await vi.waitFor( () => {
			if (
				! body.querySelector( '.os-my-wordpress__article' ) &&
				! body.querySelector( '[data-relation]' )
			) {
				throw new Error( 'detail view not painted' );
			}
		} );
	} );
} );
