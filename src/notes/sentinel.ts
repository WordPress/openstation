import { addFilter } from '../hooks';
import { __ } from '../i18n';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { DRAG_EVENTS } from '../drag/types';
import { heartbeat } from '../heartbeat';
import { NOTE_CREATED_EVENT, NOTES_HEARTBEAT_RESPONSE_FIELD } from './types';
import type { NotesLayer } from './layer';
import type { BootNotesOptions } from './index';

interface SentinelArgs extends BootNotesOptions {

	bundleUrl: string;

	hasNotes: boolean;
}

export function installNotesSentinel( args: SentinelArgs ): () => void {
	if ( ! args.bundleUrl ) {
		return () => undefined;
	}
	let loading: Promise< NotesLayer | null > | null = null;
	const stashedCreations: Event[] = [];

	let firstNoteWatcher: ( () => void ) | null = null;

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

	window.addEventListener( 'dragstart', onDragStart, true );
	document.addEventListener( DRAG_EVENTS.START, onDragStart );

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
		const idle =
			typeof requestIdleCallback === 'function'
				? requestIdleCallback
				: ( cb: () => void ) => window.setTimeout( cb, 200 );
		idle( () => void ensure() );
	} else {
		firstNoteWatcher = heartbeat.subscribe< unknown >(
			NOTES_HEARTBEAT_RESPONSE_FIELD,
			( payload ) => {
				if ( ! payload ) {
					return;
				}
				firstNoteWatcher?.();
				firstNoteWatcher = null;
				void ensure();
			},
		);
	}

	return () => {
		document.removeEventListener( NOTE_CREATED_EVENT, onNoteCreated );
		window.removeEventListener( 'dragstart', onDragStart, true );
		document.removeEventListener( DRAG_EVENTS.START, onDragStart );
		firstNoteWatcher?.();
		firstNoteWatcher = null;
	};
}
