import { __, copyText, sprintf } from '@openstation/app';
import { openPreview } from './optimistic';
import { opensOnTap } from './helpers';
import { longPress, type LongPressHandlers } from './long-press';
import { shell, uiOf, type Ctx, type ListItem, type SectionDef } from './types';

export interface RowInteractions {

	select: ( e: MouseEvent ) => void;

	activate: () => void;

	menu: ( e: MouseEvent ) => void;

	menuAt: ( anchor: Element ) => void;

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

			if ( opensOnTap() && ( section.kind === 'user' || item.canEdit ) ) {
				activate();
				return;
			}
			openPreview( ctx, item.id );
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

export async function copyWithToast( ctx: Ctx, text: string, done: string ): Promise< void > {
	const ok = await copyText( text );
	ctx.host.toast?.( {
		message: ok ? done : __( 'Could not copy — the clipboard is not available here.' ),
	} );
}

export function copyIdMessage( id: number ): string {
	return sprintf(

		__( 'Copied ID %d.' ),
		id,
	);
}

export function copyLinks( ctx: Ctx, rows: ListItem[], field: 'link' | 'shortlink' ): void {
	const links = rows.map( ( i ) => String( i[ field ] ?? '' ) ).filter( Boolean );
	let done = sprintf(

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

				__( 'Copied %d IDs.' ),
				ids.length,
			),
	);
}
