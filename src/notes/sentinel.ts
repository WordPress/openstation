/**
 * OpenStation — pinned-notes sentinel.
 *
 * The only notes code left in the shell bundle. The feature itself
 * (`notes[.min].js`: layer, motion, drop plumbing, REST client) is
 * presence-gated and loads when one of four things happens:
 *
 *   1. The boot config says this desktop HAS notes (`hasNotes`) —
 *      load on idle, so the pins appear moments after boot without
 *      taxing the critical path. A user with no notes skips the
 *      bundle AND the boot-time list request the layer used to make.
 *   2. The wallpaper context menu's "New note" — the sentinel
 *      registers the SAME filter item the bundle would (same id, so
 *      the bundle's own registration yields to it), loading on click
 *      and creating the note at the remembered position.
 *   3. `os-note-created` from the Note Pad widget — the widget POSTs
 *      the note itself and announces it; the sentinel stashes the
 *      announcement, loads, and re-dispatches so the layer's own
 *      listener pins it.
 *   4. Any drag starting — a post tile dragged toward the wallpaper can
 *      become a post→note conversion, and the drop target must exist by
 *      the time it lands. Drags give the fetch hundreds of ms of
 *      headroom. BOTH kinds count: native `dragstart` for a file coming
 *      in from the OS, and `os.drag.start` for anything starting inside
 *      the shell. The in-shell ones are pointer-driven through
 *      `DragManager` and never create a native drag, so listening for
 *      `dragstart` alone missed every Note Pad tear-off and every tile.
 */

import { addFilter } from '../hooks';
import { __ } from '../i18n';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { DRAG_EVENTS } from '../drag/types';
import { NOTE_CREATED_EVENT } from './types';
import type { NotesLayer } from './layer';
import type { BootNotesOptions } from './index';

interface SentinelArgs extends BootNotesOptions {
	/** `notes[.min].js` URL from `config.notesBundleUrl`. */
	bundleUrl: string;
	/** Boot-config presence hint (`config.hasNotes`). */
	hasNotes: boolean;
}

export function installNotesSentinel( args: SentinelArgs ): () => void {
	if ( ! args.bundleUrl ) {
		return () => undefined;
	}
	let loading: Promise< NotesLayer | null > | null = null;
	const stashedCreations: Event[] = [];

	const ensure = (): Promise< NotesLayer | null > => {
		if ( ! loading ) {
			loading = loadVendorScript( args.bundleUrl )
				.then( () => {
					const api = window.openStationNotes;
					if ( ! api ) {
						return null;
					}
					const layer = api.boot( {
						host: args.host,
						config: args.config,
						onError: args.onError,
					} );
					// The layer's own listener is attached now —
					// re-announce anything the widget created while
					// the bundle was in flight.
					document.removeEventListener(
						NOTE_CREATED_EVENT,
						onNoteCreated,
					);
					window.removeEventListener( 'dragstart', onDragStart, true );
					document.removeEventListener( DRAG_EVENTS.START, onDragStart );
					for ( const ev of stashedCreations.splice( 0 ) ) {
						document.dispatchEvent( ev );
					}
					return layer;
				} )
				.catch( ( err ) => {
					loading = null;
					// eslint-disable-next-line no-console -- silently missing notes would read as data loss.
					console.warn(
						'[openstation] notes bundle failed to load',
						err,
					);
					return null;
				} );
		}
		return loading;
	};

	const onNoteCreated = ( ev: Event ): void => {
		// Stash a CLONE — re-dispatching the original event object
		// throws once it has already been dispatched.
		stashedCreations.push(
			new CustomEvent( NOTE_CREATED_EVENT, {
				detail: ( ev as CustomEvent ).detail,
			} ),
		);
		void ensure();
	};
	document.addEventListener( NOTE_CREATED_EVENT, onNoteCreated );

	const onDragStart = (): void => {
		void ensure();
	};
	// Native `dragstart` covers a file dragged in from the OS. It does
	// NOT cover any drag that starts inside the shell: the Note Pad
	// tear-off and every desktop tile are pointer-driven through
	// `DragManager`, which never creates a native drag and instead
	// dispatches `os.drag.start` on `document`. A user with no notes
	// yet — so the bundle has not been loaded by `os-note-created`
	// either — could therefore tear a draft off the pad and have
	// nothing at all happen, because the drop handlers live in the
	// bundle this listener exists to fetch.
	window.addEventListener( 'dragstart', onDragStart, true );
	document.addEventListener( DRAG_EVENTS.START, onDragStart );

	// Same item id the bundle's own `installNotesWallpaperMenu()`
	// registers — it yields when the id is already present, so this
	// loader-item simply becomes THE item, before and after load.
	interface SentinelMenuItem {
		id: string;
		label: string;
		icon: string;
		sort: number;
		onClick: () => void;
	}
	addFilter< SentinelMenuItem[], [ { x: number; y: number } | undefined ] >(
		'os.wallpaper-context-menu',
		'desktop-mode/notes-sentinel',
		( items, context ) => {
			if ( ! Array.isArray( items ) ) {
				return items;
			}
			if ( items.some( ( item ) => item.id === 'new-note' ) ) {
				return items;
			}
			const { x, y } = context ?? { x: 0, y: 0 };
			return [
				...items,
				{
					id: 'new-note',
					label: __( 'New note', 'desktop-mode' ),
					icon: 'dashicons-edit-page',
					sort: 14,
					onClick: () => {
						void ensure().then( ( layer ) => {
							if ( ! layer ) {
								return;
							}
							const position = layer.normalizedFromClient( x, y );
							layer.createNoteAt( { ...position, focus: true } );
						} );
					},
				},
			];
		},
	);

	if ( args.hasNotes ) {
		// Present notes should appear without any gesture — but a
		// beat after boot, off the critical path.
		const idle =
			typeof requestIdleCallback === 'function'
				? requestIdleCallback
				: ( cb: () => void ) => window.setTimeout( cb, 200 );
		idle( () => void ensure() );
	}

	// Uninstall for callers (and tests) tearing down an un-booted
	// sentinel; the boot path removes the gesture listeners itself.
	return () => {
		document.removeEventListener( NOTE_CREATED_EVENT, onNoteCreated );
		window.removeEventListener( 'dragstart', onDragStart, true );
		document.removeEventListener( DRAG_EVENTS.START, onDragStart );
	};
}
