/**
 * My WordPress — what a row does when touched.
 *
 * Part of the `my-wordpress` client view: imported by the tile canvas
 * (`list-views.ts`) and the table (`list-table.ts`) alike, so a tile
 * and a row answer a click, a double click and a right-click the same
 * way — one definition of "select", "activate" and "menu", two
 * costumes. Also the clipboard verbs both surfaces offer.
 *
 * @public
 */

import { __, copyText, sprintf } from '@openstation/app';
import { opensOnTap } from './helpers';
import { longPress, type LongPressHandlers } from './long-press';
import { shell, uiOf, type Ctx, type ListItem, type SectionDef } from './types';

export interface RowInteractions {
	/**
	 * Click: Finder selection, and a plain click opens the pane. Where
	 * a tap is all there is (`opensOnTap`), a plain click activates.
	 */
	select: ( e: MouseEvent ) => void;
	/** Double click / Enter: open in the editor (users: the footprint). */
	activate: () => void;
	/** Right click: the context menu at the pointer. */
	menu: ( e: MouseEvent ) => void;
	/** The same menu, anchored under an element (a row's ⋯ button). */
	menuAt: ( anchor: Element ) => void;
	/** The same menu on a finger held still — the touch right-click (`long-press.ts`). */
	press: LongPressHandlers;
}

export function rowInteractions(
	ctx: Ctx,
	section: SectionDef,
	item: ListItem,
	order: number[],
): RowInteractions {
	const openMenu = ( x: number, y: number ): void => {
		uiOf( ctx ).menu = { x, y, item };
		ctx.repaint();
	};
	const activate = (): void => {
		// A plugin may claim "the user opened this person" — WP
		// Explorer's `os.my-wordpress.user-activate` seam, verbatim.
		// A shop's Customers folder opens the customer window; the
		// built-in fallthrough keeps double-click meaning something
		// when no subscriber answers.
		if ( section.kind === 'user' ) {
			const handled = shell().hooks?.applyFilters(
				'os.my-wordpress.user-activate',
				false,
				{
					entityId: section.id,
					kind: section.kind,
					item: item as unknown as Record< string, unknown >,
				},
			);
			if ( handled === true ) {
				return;
			}
			// The built-in answer, WP Explorer's: opening a person is
			// their activity footprint — the profile editor stays one
			// right-click (or pane button) away.
			void ctx.dispatch( 'footprint', { user: item.id, name: item.title } );
			return;
		}
		if ( item.canEdit ) {
			void ctx.dispatch( 'edit', { item: item.id } );
		}
	};
	return {
		select: ( e ) => {
			ctx.local( 'select', {
				item: item.id,
				ctrl: e.ctrlKey || e.metaKey,
				shift: e.shiftKey,
				order,
			} );
			if ( e.ctrlKey || e.metaKey || e.shiftKey ) {
				return;
			}
			// One tap opens where a double tap is not to be had. An item
			// that cannot be edited (no capability) still opens its pane,
			// so the tap is never answered with nothing.
			if ( opensOnTap() && ( section.kind === 'user' || item.canEdit ) ) {
				activate();
				return;
			}
			void ctx.dispatch( 'open', { item: item.id } );
		},
		activate,
		menu: ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			openMenu( e.clientX, e.clientY );
		},
		menuAt: ( anchor ) => {
			const rect = anchor.getBoundingClientRect();
			openMenu( rect.left, rect.bottom + 2 );
		},
		press: longPress( openMenu ),
	};
}

/**
 * Copy one value and say so — or say it failed, which the bare
 * `navigator.clipboard` call never did.
 */
export async function copyWithToast( ctx: Ctx, text: string, done: string ): Promise< void > {
	const ok = await copyText( text );
	ctx.host.toast?.( {
		message: ok ? done : __( 'Could not copy — the clipboard is not available here.' ),
	} );
}

/** "Copied ID 123." */
export function copyIdMessage( id: number ): string {
	return sprintf(
		/* translators: %d: the copied id. */
		__( 'Copied ID %d.' ),
		id,
	);
}

/** The clipboard verbs for a set of rows — the menu and the row cluster share them. */
export function copyLinks( ctx: Ctx, rows: ListItem[], field: 'link' | 'shortlink' ): void {
	const links = rows.map( ( i ) => String( i[ field ] ?? '' ) ).filter( Boolean );
	let done = sprintf(
		/* translators: %d: link count. */
		__( 'Copied %d links.' ),
		links.length,
	);
	if ( links.length === 1 ) {
		done = field === 'shortlink' ? __( 'Copied the shortlink.' ) : __( 'Copied the link.' );
	}
	void copyWithToast( ctx, links.join( '\n' ), done );
}

export function copyIds( ctx: Ctx, rows: ListItem[] ): void {
	const ids = rows.map( ( i ) => i.id );
	void copyWithToast(
		ctx,
		ids.join( ', ' ),
		ids.length === 1
			? copyIdMessage( ids[ 0 ] )
			: sprintf(
				/* translators: %d: id count. */
				__( 'Copied %d IDs.' ),
				ids.length,
			),
	);
}
