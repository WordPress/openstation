import { __ } from '../i18n';
import { addAction, HOOKS } from '../hooks';
import { beginTrashChange, trashItem } from './trash-optimistic';
import { trashByRestPath } from './rest-trash';
import type { DragManagerApi, DragSession } from '../drag';
import { trashManyWithUndo } from './trash';
import { showToast } from '../toast';
import { restFailureText } from '../core/rest-failure';
import {
	recycleBinPayloadAccepts,
	recycleBinPayloadDrop,
} from './recycle-bin-payloads';
import type { RestPlacementShape } from './rest';
import {
	dragPlacements,
	dragShortcutItems,
	type DesktopFileDragData,
	type ShortcutDragData,
} from './drag-payloads';

const UNTRASHABLE_SHORTCUT_KINDS: ReadonlySet< string > = new Set( [
	'user',
	'attachment',
] );

const TRASH_DROP_ACTIVE_ATTR = 'data-os-trash-drop-active';
const RECYCLE_BIN_WINDOW_ID = 'desktop-mode-recycle-bin';

const BIN_SURFACES = [
	{ id: 'recycle-bin-tile', selector: `.os-file-tile[data-file-ref="${ RECYCLE_BIN_WINDOW_ID }"]` },
	{ id: 'recycle-bin-icon', selector: `[data-icon-id="${ RECYCLE_BIN_WINDOW_ID }"]` },
	{ id: 'recycle-bin-dock', selector: `[data-system-id="${ RECYCLE_BIN_WINDOW_ID }"]` },
	{ id: 'recycle-bin-window', selector: '[data-os-recycle-bin-root]' },
] as const;

let _installed = false;
interface BinRegistration {
	el: HTMLElement;
	deregister: () => void;
}

const _surfaceRegistrations = new Map< string, BinRegistration >();
let _binMutationObserver: MutationObserver | null = null;

interface DesktopFilePayloadData {
	placement: RestPlacementShape;
}

function isDesktopFilePayload(
	session: DragSession,
): session is DragSession & { payload: { type: 'desktop-file'; data: DesktopFilePayloadData } } {
	return session.payload.type === 'desktop-file';
}

function isShortcutPayload(
	session: DragSession,
): session is DragSession & { payload: { type: 'shortcut'; data: ShortcutDragData } } {
	return session.payload.type === 'shortcut';
}

function isTrashableShortcut( data: Partial< ShortcutDragData > ): boolean {
	if ( ! data.kind || ! data.ref || ! data.restPath ) {
		return false;
	}
	if ( UNTRASHABLE_SHORTCUT_KINDS.has( data.kind ) ) {
		return false;
	}
	const numericRef = Number.parseInt( data.ref, 10 );
	return Number.isFinite( numericRef ) && numericRef > 0;
}

function registerOn(
	dragManager: DragManagerApi,
	id: string,
	el: HTMLElement,
): () => void {
	return dragManager.registerDropTarget( {
		id,
		element: el,

		acceptLabel: __( 'Move to Trash', 'desktop-mode' ),

		accept: ( payload ) => {
			if ( payload.type === 'desktop-file' ) {
				const data = payload.data as Partial< DesktopFilePayloadData >;
				const placement = data?.placement;
				if ( ! placement ) {
					return false;
				}

				const set = dragPlacements(
					data as unknown as DesktopFileDragData,
				);
				if ( set.length > 1 ) {
					return set.every(
						( p ) =>
							p.file?.ref !== RECYCLE_BIN_WINDOW_ID &&
							p.canTrash !== false,
					);
				}

				if ( placement.file?.ref === RECYCLE_BIN_WINDOW_ID ) {
					return false;
				}

				return placement.canTrash !== false;
			}

			if ( payload.type === 'shortcut' ) {
				const data = payload.data as Partial< ShortcutDragData >;
				const set = dragShortcutItems( data as ShortcutDragData );
				return (
					set.length > 0 && set.every( ( i ) => isTrashableShortcut( i ) )
				);
			}

			return recycleBinPayloadAccepts( payload );
		},
		onEnter: () => {
			el.setAttribute( TRASH_DROP_ACTIVE_ATTR, '' );
		},
		onLeave: () => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
		},
		onDrop: ( session, ev ) => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
			if ( isDesktopFilePayload( session ) ) {
				void trashManyWithUndo(
					dragPlacements(
						session.payload.data as unknown as DesktopFileDragData,
					),
				);
				return;
			}
			if (
				session.payload.type !== 'shortcut' &&
				recycleBinPayloadDrop( session, ev )
			) {
				return;
			}
			if ( isShortcutPayload( session ) ) {
				const set = dragShortcutItems( session.payload.data );
				const trashing = set
					.map( ( item ) => ( {
						title: item.title ?? '',
						icon: item.icon ?? '',
						restPath: item.restPath,
						kind: item.kind,
						ref: Number.parseInt( item.ref, 10 ),
					} ) )
					.filter(
						( t ): t is { restPath: string; kind: string; ref: number; title: string; icon: string } =>
							!! t.restPath &&
							Number.isFinite( t.ref ) &&
							t.ref > 0,
					);
				if ( trashing.length === 0 ) {
					return;
				}
				const operations = trashing.map( ( t ) => beginTrashChange( trashItem( {
					id: t.ref, type: t.kind, title: t.title, icon: t.icon,
				} ) ) );
				void Promise.allSettled(
					trashing.map( ( t, i ) => operations[ i ] ? trashByRestPath( t.restPath, t.ref ) : Promise.reject( new Error( 'Item is already moving to Trash.' ) ) ),
				).then( ( results ) => {
					const failed = results.filter(
						( r ) => r.status === 'rejected',
					);
					for ( const failure of failed ) {
						console.error(
							'[openstation] recycle-bin: shortcut trash failed:',
							( failure as PromiseRejectedResult ).reason,
						);
					}

					const trashed = trashing
						.filter( ( _t, i ) => results[ i ]?.status === 'fulfilled' )
						.reduce< Record< string, number[] > >( ( acc, t ) => {
							( acc[ t.kind ] ??= [] ).push( t.ref );
							return acc;
						}, {} );
					const announce = (
						window.wp as
							| {
									os?: {
										announceContentChange?: (
											type: string,
											action: string,
											ids: number[],
											owner?: string,
										) => void;
									};
							}
							| undefined
					)?.os?.announceContentChange;
					for ( const [ kind, ids ] of Object.entries( trashed ) ) {
						announce?.( kind, 'trashed', ids, 'recycle-bin' );
					}
					results.forEach( ( result, i ) => {
						void operations[ i ]?.finish( result.status === 'fulfilled' );
					} );
					const moved = trashing.length - failed.length;
					if ( moved > 1 || failed.length > 0 ) {
						const reason = failed.length > 0
							? restFailureText( ( failed[ 0 ] as PromiseRejectedResult ).reason )
							: '';
						const toast: { message: string; duration: number; type?: string } = {
							message:
								failed.length > 0
									? `${ moved } moved to Trash · ${ failed.length } could not be moved${ reason ? `: ${ reason }` : '' }`
									: `${ moved } items moved to Trash`,
							duration: failed.length > 0 ? 6000 : 4000,
						};
						if ( failed.length > 0 ) {
							toast.type = moved > 0 ? 'warning' : 'error';
						}
						showToast( toast );
					}
				} );
			}
		},
	} );
}

export function installRecycleBinDropTargets( dragManager: DragManagerApi ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;

	const reprobeSurfaces = (): void => {
		for ( const { id, selector } of BIN_SURFACES ) {
			const el = document.querySelector( selector );
			const live = el instanceof HTMLElement ? el : null;
			const current = _surfaceRegistrations.get( id );
			if ( ! live ) {
				current?.deregister();
				_surfaceRegistrations.delete( id );
				continue;
			}
			if ( current && current.el === live ) {
				continue;
			}
			current?.deregister();
			_surfaceRegistrations.set( id, {
				el: live,
				deregister: registerOn( dragManager, id, live ),
			} );
		}
	};

	reprobeSurfaces();

	document.addEventListener( 'os-files-changed', reprobeSurfaces );

	addAction(
		HOOKS.DESKTOP_ICONS_RENDERED,
		'desktop-mode/files/recycle-bin-icons-target',
		reprobeSurfaces,
	);
	addAction(
		HOOKS.DOCK_AFTER_RENDER,
		'desktop-mode/files/recycle-bin-dock-target',
		reprobeSurfaces,
	);

	if ( typeof MutationObserver !== 'undefined' ) {
		_binMutationObserver = new MutationObserver( () => {
			reprobeSurfaces();
		} );
		const desktopArea =
			document.getElementById( 'os-area' ) ?? document.body;
		_binMutationObserver.observe( desktopArea, {
			childList: true,
			subtree: true,
		} );
	}
}

export function __resetRecycleBinDropTargetsForTests(): void {
	for ( const { deregister } of _surfaceRegistrations.values() ) {
		deregister();
	}
	_surfaceRegistrations.clear();
	_binMutationObserver?.disconnect();
	_binMutationObserver = null;
	_installed = false;
}
