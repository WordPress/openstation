/**
 * OpenStation — "New note" wallpaper context-menu entry, so the wall
 * has a door that isn't the Note Pad widget.
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
			// Snapshot now — `onClick` runs after this menu has closed.
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
