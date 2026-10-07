import { __ } from '../i18n';
import { broadcastNotesChange } from './broadcast';
import { describeRestFailure, restFailureKind, toastRestFailure } from '../core/rest-failure';
import { shellToast } from '../core/shell-toast';
import { convertNote, restoreNote, type ConvertNoteResult } from './rest';
import type { Note } from './types';

interface DesktopApi {
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;

	config?: { adminUrl?: string };
	windowManager?: {
		open?: ( config: {
			id: string;
			baseId?: string;
			url: string;
			title?: string;
			icon?: string;
		} ) => unknown;
		getById?: ( id: string ) => { close?: () => void } | undefined;
	};
}

function getDesktopApi(): DesktopApi | null {
	return ( window as { wp?: { os?: DesktopApi } } ).wp?.os ?? null;
}

export function resolveDraftEditUrl(
	result: Pick< ConvertNoteResult, 'editUrl' | 'postId' >,
	adminUrl: string | undefined,
): string {
	const editUrl = typeof result.editUrl === 'string' ? result.editUrl : '';
	let sameOrigin = false;
	if ( editUrl ) {
		try {
			const origin = adminUrl
				? new URL( adminUrl, window.location.href ).origin
				: window.location.origin;
			sameOrigin = new URL( editUrl, window.location.href ).origin === origin;
		} catch {
			sameOrigin = false;
		}
	}
	if ( sameOrigin ) {
		return editUrl;
	}
	const postId = Math.floor( Number( result.postId ) );
	if ( adminUrl && Number.isFinite( postId ) && postId > 0 ) {
		const base = adminUrl.endsWith( '/' ) ? adminUrl : `${ adminUrl }/`;
		return `${ base }post.php?post=${ postId }&action=edit`;
	}
	return editUrl;
}

function shellAdminUrl(): string | undefined {
	const fromApi = getDesktopApi()?.config?.adminUrl;
	if ( typeof fromApi === 'string' && fromApi ) {
		return fromApi;
	}
	const global = (
		window as unknown as { openStationConfig?: { adminUrl?: unknown } }
	).openStationConfig?.adminUrl;
	return typeof global === 'string' && global ? global : undefined;
}

function openDraftEditor( result: ConvertNoteResult ): string | null {
	try {
		const api = getDesktopApi();
		const url = resolveDraftEditUrl( result, shellAdminUrl() );
		if ( ! url ) {
			throw new Error( 'the convert route returned no edit URL.' );
		}
		if ( ! api?.windowManager?.open || ! api.deriveWindowId ) {
			window.location.href = url;
			return null;
		}
		const id = api.deriveWindowId( url );

		void Promise.resolve(
			api.windowManager.open( {
				id,
				baseId: id,
				url,
				title: __( 'Edit draft', 'desktop-mode' ),
				icon: 'dashicons-admin-post',
			} ),
		).catch( ( err: unknown ) => {
			console.error(
				'[openstation] notes: draft editor failed to open:',
				err,
			);
		} );
		return id;
	} catch ( err ) {
		console.error( '[openstation] notes: draft editor failed to open:', err );
		return null;
	}
}

export function convertFailureMessage( err: unknown ): string {
	if ( restFailureKind( err ) === 'unreadable' ) {
		return __(
			'The site sent an unreadable reply while converting the note. Check Posts → Drafts before trying again.',
			'desktop-mode',
		);
	}
	return describeRestFailure( err, {
		fallback: __( 'Could not convert the note to a post.', 'desktop-mode' ),
	} ).message;
}

export interface ConvertNoteCallbacks {

	onEvict( noteId: number ): void;

	onRestore( note: Note ): void;
}

export async function convertNoteToPost(
	note: Note,
	callbacks: ConvertNoteCallbacks,
): Promise< void > {
	callbacks.onEvict( note.id );
	let result: ConvertNoteResult;
	try {
		result = await convertNote( note.id );
	} catch ( err ) {
		console.error( '[openstation] notes: convert failed:', err );
		callbacks.onRestore( note );
		shellToast( {
			message: convertFailureMessage( err ),
			type: 'error',
			duration: 5000,
		} );
		return;
	}

	broadcastNotesChange( 'trashed', [ note.id ] );
	const editorWindowId = openDraftEditor( result );
	const converted = editorWindowId
		? __( 'Note converted to a draft post', 'desktop-mode' )
		: __( 'Note converted to a draft post. Find it under Posts → Drafts.', 'desktop-mode' );
	shellToast( {
		message: converted,
		duration: 6000,
		action: {
			label: __( 'Undo', 'desktop-mode' ),
			onClick: () => {
				if ( editorWindowId ) {
					getDesktopApi()
						?.windowManager?.getById?.( editorWindowId )
						?.close?.();
				}
				void restoreNote( note.id )
					.then( ( restored ) => {
						broadcastNotesChange( 'untrashed', [ note.id ] );
						callbacks.onRestore( restored );
					} )
					.catch( ( err: unknown ) => {
						console.error(
							'[openstation] notes: convert undo failed:',
							err,
						);
						toastRestFailure( shellToast, err, {
							fallback: __( 'Could not restore the note.', 'desktop-mode' ),
							duration: 5000,
						} );
					} );
			},
		},
	} );
}
