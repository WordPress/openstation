/**
 * Posts app — a row's actions menu.
 *
 * One `<os-action-menu>` per row: Edit, View, the links plugins add to
 * the row on `edit.php` (`parts/row-actions.php`), then Move to trash or
 * Restore. The Page directory card, the details pane and the Details
 * table's title cell all build it here, so their entries cannot drift.
 * It is an element rather than a template because the table paints its
 * cells inside its own shadow root.
 *
 * @public
 */

import { __, _n, sprintf } from '@openstation/app';
import '../../../src/ui/components/os-action-menu/os-action-menu';
import { buildEditPostUrl, titleOf, type CellEnv } from './cells/env';
import type { PostListItem, PostsMode, RowActionLink } from './types';

/** What the menu needs from the app beyond the cell env. */
export interface RowActions {
	/** The row's plugin links, in the server's order; empty until they land. */
	links: ( id: number ) => RowActionLink[];
	/** The app's own `trash` / `restore` actions. */
	trash: ( ids: number[] ) => Promise< unknown >;
	restore: ( ids: number[] ) => Promise< unknown >;
}

/** A built menu, with what it was built from. */
export type RowActionsMenuCache = Map< string, { key: string; el: HTMLElement } >;

/** The question before moving rows to the trash — the bulk bar asks it too. */
export function trashConfirmMessage( mode: PostsMode, count: number ): string {
	return mode === 'pages'
		? sprintf(
			/* translators: %d: row count. */
			_n( 'Move %d page to the trash?', 'Move %d pages to the trash?', count ),
			count,
		)
		: sprintf(
			/* translators: %d: row count. */
			_n( 'Move %d post to the trash?', 'Move %d posts to the trash?', count ),
			count,
		);
}

function option( value: string, label: string ): HTMLElement {
	const el = document.createElement( 'os-context-menu-option' );
	el.setAttribute( 'value', value );
	el.textContent = label;
	return el;
}

/** Build a row's actions menu. */
export function buildRowActionsMenu( row: PostListItem, env: CellEnv, actions: RowActions ): HTMLElement {
	const mode: PostsMode = env.extra.mode === 'pages' ? 'pages' : 'posts';
	const icon = mode === 'pages' ? 'dashicons-admin-page' : 'dashicons-admin-post';
	const title = titleOf( row ) || __( '(no title)' );
	const trashed = row.status === 'trash';
	const links = actions.links( row.id );

	const menu = document.createElement( 'os-action-menu' );
	menu.setAttribute( 'text', '⋯' );
	/* translators: %s: page or post title. */
	menu.setAttribute( 'label', sprintf( __( 'Actions for %s' ), title ) );
	menu.setAttribute( 'data-os-posts-row-actions', String( row.id ) );
	// Picking an entry must not also click the table row it sits in.
	menu.setAttribute( 'data-noclick', '' );
	if ( ! trashed ) {
		menu.appendChild( option( 'edit', __( 'Edit' ) ) );
	}
	if ( row.status === 'publish' && row.link ) {
		menu.appendChild( option( 'view', `${ __( 'View' ) } ↗` ) );
	}
	links.forEach( ( link, index ) => menu.appendChild( option( `link:${ index }`, link.admin ? link.label : `${ link.label } ↗` ) ) );
	menu.appendChild( trashed ? option( 'restore', __( 'Restore' ) ) : option( 'trash', __( 'Move to trash' ) ) );

	menu.addEventListener( 'os-context-menu-pick', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail?.value ?? '';
		if ( value === 'edit' ) {
			env.openUrl( buildEditPostUrl( env.extra, row.id ), title, icon );
		} else if ( value === 'view' && row.link ) {
			window.open( row.link, '_blank', 'noopener,noreferrer' );
		} else if ( value.startsWith( 'link:' ) ) {
			const link = links[ Number( value.slice( 5 ) ) ];
			if ( link?.admin ) {
				env.openUrl( link.url, link.label, icon );
			} else if ( link ) {
				window.open( link.url, '_blank', 'noopener,noreferrer' );
			}
		} else if ( value === 'trash' ) {
			void env.confirm( { message: trashConfirmMessage( mode, 1 ), danger: true } ).then( ( yes ) => {
				if ( yes ) {
					void actions.trash( [ row.id ] );
				}
			} );
		} else if ( value === 'restore' ) {
			void actions.restore( [ row.id ] );
		}
	} );
	return menu;
}

/**
 * A row's menu for one surface, rebuilt only when what it shows
 * changed: a repaint that swapped the element would close a menu the
 * user has open.
 */
export function rowActionsMenu( cache: RowActionsMenuCache, surface: string, row: PostListItem, env: CellEnv, actions: RowActions ): HTMLElement {
	const key = JSON.stringify( [ row.status, row.link, row.title.rendered, actions.links( row.id ) ] );
	const slot = `${ surface }|${ row.id }`;
	const cached = cache.get( slot );
	if ( cached && cached.key === key ) {
		return cached.el;
	}
	const el = buildRowActionsMenu( row, env, actions );
	cache.set( slot, { key, el } );
	return el;
}
