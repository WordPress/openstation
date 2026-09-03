/**
 * Comments — the client view of the moderation app.
 *
 * The 1:1 rebuild of the native Comments window's conversation view:
 * the same tab strip (and its narrow-window picker), the same rail of
 * conversations with its search, post-scope banner and Load more, the
 * same nested thread with per-message actions, inline edit and docked
 * composer, the same one-pane phone layout stamped on the root. What
 * the framework absorbed: the REST client and its config blob (the
 * rail, the thread and the counts ride every `data()`), the
 * sequence-token race guards (dispatches are serialised), the
 * `os.comment.changed` subscription (`watch( 'comment' )`), the
 * shared-store post filter (the `post` open-time param and the
 * `reopen` lifecycle), and the hand-built DOM.
 *
 * @public
 */

import { createPagedList, defineApp, html } from '@openstation/app';
import { applyAvatarSrc } from '../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../src/utils';
import { NS } from './parts/helpers';
import { rail, tabs } from './parts/rail';
import { conversation } from './parts/thread';
import type { AppData, AppState, CommentRow, Ctx, UiState } from './parts/types';

export type { AppData, AppState, CommentRow, CommentTab, UiState } from './parts/types';
export { normalizeStatus, statusLabel, statusTone, snippet, buildTree } from './parts/helpers';

/** The app id — the legacy native window's FROZEN identifier (see AGENTS.md). */
const APP_ID = 'desktop-mode-comments';

export const freshUi = (): UiState => ( {
	pane: 'rail',
	status: '',
	draft: '',
	replyTo: 0,
	editing: 0,
	editSeed: '',
	editDraft: '',
	busy: '',
	loadingMore: false,
	list: createPagedList< CommentRow >(),
	announcedPost: -1,
	draftFor: -1,
	bodies: new Map(),
} );

/**
 * Announce (or clear) this window's content identity so the
 * window-links engine draws the connection spline to the post's
 * editor — the tie the classic `edit-comments.php?p=` iframe got from
 * the chromeless bridge. Grouping is by `root`, so a comment window of
 * post N roots at that post.
 */
function announcePostIdentity( ctx: Ctx, postId: number, title?: string ): void {
	const relations = ( window as unknown as {
		wp?: { os?: { relations?: { set?: ( id: string, ref: unknown ) => void } } };
	} ).wp?.os?.relations;
	// The relations API keys by the manager's window id — the DOM root
	// is `id="wp-window-<windowId>"`.
	const windowId = ctx.root.closest< HTMLElement >( '[id^="wp-window-"]' )?.id.slice( 'wp-window-'.length );
	if ( ! relations?.set || ! windowId ) {
		return;
	}
	const ref =
		postId > 0
			? {
				type: 'comment',
				id: postId,
				root: { type: 'post', id: postId },
				label: title ? decodeHTML( title ) : undefined,
			}
			: null;
	try {
		relations.set( windowId, ref );
	} catch {
		// Malformed ref / API rejected it — the spline is cosmetic, ignore.
	}
}

export default defineApp< AppState, AppData >( APP_ID, {
	view: ( ctx ) => {
		const { state, data } = ctx;
		const ui = ctx.ui( freshUi );
		// The rail accumulates pages under the server's key — a new tab,
		// search, scope or mutation starts it clean.
		const rows = ui.list.accumulate( data.railKey, data.rail );
		const root = rows.find( ( r ) => r.id === state.selected );
		// A change of conversation resets the composer: a draft written
		// to one thread must not send under another.
		if ( ui.draftFor !== state.selected ) {
			ui.draftFor = state.selected;
			ui.draft = '';
			ui.replyTo = 0;
			ui.editing = 0;
		}
		// Nothing to read: a narrow window shows the list.
		const pane = root ? ui.pane : 'rail';
		return html`
			<div class="${ NS } ${ NS }--conversation" data-os-comments-root data-os-comments-pane=${ pane }>
				${ tabs( ctx, ui ) }
				<div class="${ NS }__split">
					${ rail( ctx, ui, rows ) }
					${ conversation( ctx, ui, root ) }
				</div>
				<div class="${ NS }__status screen-reader-text" role="status" aria-live="polite" data-os-comments-status>${ ui.status }</div>
			</div>
		`;
	},

	mounted: ( ctx ) => {
		// The stylesheet reads the shell's mode stamp; a crossing between
		// the desk and the phone band repaints nothing on its own.
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			document.removeEventListener( 'os-mode-changed', onModeChange );
			ctx.ui( freshUi ).list.dispose();
		};
	},

	updated: ( ctx ) => {
		const ui = ctx.ui( freshUi );
		// Gravatar probing: the helper removes the src when the address
		// has no registered avatar, so the initials tile shows instead
		// of an empty circle. Once per element.
		ctx.root
			.querySelectorAll< HTMLElement >( 'os-avatar[data-avatar-src]:not([data-avatar-applied])' )
			.forEach( ( el ) => {
				el.setAttribute( 'data-avatar-applied', '' );
				const url = el.getAttribute( 'data-avatar-src' ) ?? '';
				if ( url ) {
					applyAvatarSrc( el, url );
				}
			} );
		// Scoped to a post → announce identity so the connection spline to
		// the post's editor is drawn (parity with the classic iframe); a
		// cleared scope clears it.
		const post = ctx.state.post;
		if ( post !== ui.announcedPost ) {
			ui.announcedPost = post;
			announcePostIdentity( ctx, post, ui.list.items()[ 0 ]?.openstation_post_title );
		}
	},
} );
