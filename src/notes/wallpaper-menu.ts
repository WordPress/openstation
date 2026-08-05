/**
 * OpenStation — "New note" wallpaper context-menu entry.
 *
 * Right-click empty wallpaper → New note. The paper lands where the
 * click was, empty, with its editor focused — the Note Pad widget is
 * the composer, but it shouldn't be the only door to the wall.
 *
 * The filter's second argument carries the click position; the menu
 * synthesizes a bare `MouseEvent` for `onClick`, so reading
 * coordinates off the event there would give `(0, 0)`.
 */

import { addFilter } from '../hooks';
import { __ } from '../i18n';
import type {
	WallpaperMenuContext,
	WallpaperMenuItem,
} from '../desktop-files/wallpaper-menu';
import type { NotesLayer } from './layer';

const MENU_ITEM_ID = 'new-note';

export function installNotesWallpaperMenu( layer: NotesLayer ): void {
	addFilter< WallpaperMenuItem[], [ WallpaperMenuContext ] >(
		'os.wallpaper-context-menu',
		'desktop-mode/notes',
		( items, context ) => {
			if ( ! Array.isArray( items ) ) {
				return items;
			}
			if ( items.some( ( item ) => item.id === MENU_ITEM_ID ) ) {
				return items;
			}
			// Snapshot the coordinates now: `context` belongs to this
			// menu opening, but `onClick` runs after it has closed.
			const { x, y } = context ?? { x: 0, y: 0 };
			return [
				...items,
				{
					id: MENU_ITEM_ID,
					label: __( 'New note', 'desktop-mode' ),
					icon: 'dashicons-edit-page',
					sort: 14,
					onClick: () => {
						const position = layer.normalizedFromClient( x, y );
						layer.createNoteAt( { ...position, focus: true } );
					},
				},
			];
		},
	);
}
