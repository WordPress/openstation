/**
 * OpenStation — Pinned notes "convert to post" flow.
 *
 * Spawn a draft post from a note (`POST /notes/:id/convert` server-side),
 * with optimistic eviction, auto-opening the draft in the block editor,
 * and an Undo toast that reverses BOTH sides — restoring the note and
 * discarding the draft (the server's restore route consumes the note→
 * draft link, see `openstation_notes_rest_restore`). Mirrors the trash
 * flow (`src/notes/trash.ts`); the layer injects eviction/restore
 * callbacks so this module stays DOM-free.
 *
 * Two steps, judged separately. The server step either converts or it
 * does not, and only its failure puts the note back on the wall, with
 * the reason the route gave, not one line for every failure. Once the
 * server has answered 200 the note IS trashed and the draft IS there,
 * so a browser-side failure opening the editor afterwards must not
 * report a failed conversion or resurrect a stale copy of a trashed
 * note; it says where the draft went instead.
 */

import { __ } from '../i18n';
import { broadcastNotesChange } from './broadcast';
import { describeRestFailure, restFailureKind } from '../core/rest-failure';
import { shellToast } from '../core/shell-toast';
import { convertNote, restoreNote, type ConvertNoteResult } from './rest';
import type { Note } from './types';

interface DesktopApi {
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	/** The boot config (`wp.os.config`), carrying `adminUrl`. */
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

/**
 * The URL the editor window should load.
 *
 * A window is an iframe of THIS site's wp-admin, so the only edit URL
 * it can ever render is one on this origin. The route returns
 * `get_edit_post_link()`, and a host can filter that to somewhere
 * else (WordPress.com points post edit links at its own editor on
 * wordpress.com) or blank it. Either way the draft still lives in
 * this site's `post.php`, so rebuild the admin URL from the draft id
 * and fall back to the server's string only when nothing better is
 * known (no admin URL at hand, or no post id to build from).
 */
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

/** `wp.os.config.adminUrl`, or the boot global it was read from. */
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

/**
 * Open the draft's admin edit URL as a chromeless window and return the
 * window id (so Undo can close it again), or `null` when no window
 * could be opened. Never throws: by the time this runs the server has
 * converted, and the caller reports that outcome whatever happens here.
 * Falls back to a full-tab navigation only if the window APIs are
 * somehow absent; the shell exposes both at boot, so that path is
 * effectively dead.
 */
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
		// `open()` is async: a rejection there (the window-system bundle
		// failing to load, a config the manager refuses) is not a
		// synchronous throw, so settle it here rather than leaving an
		// unhandled rejection with no note of what it was about.
		void Promise.resolve(
			api.windowManager.open( {
				id,
				baseId: id,
				url,
				title: __( 'Edit draft', 'desktop-mode' ),
				icon: 'dashicons-admin-post',
			} ),
		).catch( ( err: unknown ) => {
			// eslint-disable-next-line no-console
			console.error(
				'[openstation] notes: draft editor failed to open:',
				err,
			);
		} );
		return id;
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] notes: draft editor failed to open:', err );
		return null;
	}
}

/**
 * The toast line for a failed convert, in plain words. One line is this
 * flow's own: an unreadable 200 means the server MAY have converted, so
 * it says where to look. Everything else is the shared answer
 * (`describeRestFailure`): the route's own localized `WP_Error`
 * message, then a line per failure class the status tells apart, then
 * the generic one.
 */
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
	/** Remove the note from the wall (optimistic). */
	onEvict( noteId: number ): void;
	/** Put a restored note back (Undo succeeded, or convert failed). */
	onRestore( note: Note ): void;
}

/**
 * Convert with auto-open + Undo. If the server refuses, the note is put
 * back so the wall stays truthful and the toast says why. Undo restores
 * the note and (server-side) trashes the draft, then closes the editor
 * window this flow opened.
 */
export async function convertNoteToPost(
	note: Note,
	callbacks: ConvertNoteCallbacks,
): Promise< void > {
	callbacks.onEvict( note.id );
	let result: ConvertNoteResult;
	try {
		result = await convertNote( note.id );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] notes: convert failed:', err );
		callbacks.onRestore( note );
		shellToast( {
			message: convertFailureMessage( err ),
			type: 'error',
			duration: 5000,
		} );
		return;
	}

	// From here on the note is trashed server-side and the draft exists,
	// whatever the browser manages next. Convert trashes the source
	// note, so the bin gained an item.
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
				// Close the editor we auto-opened first: restoring
				// the note also trashes the draft server-side, so
				// leaving its window open would show a trashed post.
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
						// eslint-disable-next-line no-console
						console.error(
							'[openstation] notes: convert undo failed:',
							err,
						);
						shellToast( {
							...describeRestFailure( err, {
								fallback: __( 'Could not restore the note.', 'desktop-mode' ),
							} ),
							duration: 5000,
						} );
					} );
			},
		},
	} );
}
