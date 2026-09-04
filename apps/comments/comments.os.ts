/**
 * Comments — the client view of the moderation app.
 *
 * A conversation view: the tab strip (and its narrow-window picker),
 * the rail of conversations with its search, post-scope banner and
 * Load more, the nested thread with per-message actions, inline edit
 * and docked composer, and a one-pane phone layout stamped on the
 * root. The rail, the thread and the counts ride `data()`; a response
 * that leaves a half out (a `select` changes no rail, Load more no
 * thread) keeps what is on screen. Dispatches are serialised by the
 * runtime; the `os.comment.changed` broadcasts of OTHER windows refresh
 * through `watch( 'comment' )`, this window's own are its echo; the
 * `edit-comments.php?p=<id>` scope is the `post` open-time param and
 * the `reopen` lifecycle.
 *
 * @public
 */

import { createPagedList, defineApp, html } from '@openstation/app';
import { applyAvatarSrc } from '../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../src/utils';
import { NS, pruneBodies } from './parts/helpers';
import { rail, tabs } from './parts/rail';
import { conversation } from './parts/thread';
import type { AppData, AppState, CommentRow, Ctx, UiState } from './parts/types';

export type { AppData, AppState, CommentRow, CommentTab, Thread, UiState } from './parts/types';
export { normalizeStatus, statusLabel, statusTone, snippet, plainText, pickAvatarUrl, buildTree } from './parts/helpers';

/** The app id — the native window's FROZEN identifier (see AGENTS.md). */
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
	thread: null,
	tree: { rows: null, byParent: new Map() },
	announcedPost: -1,
	draftFor: -1,
	bodies: new Map(),
} );

type Textarea = HTMLElement & { clear?: () => void };

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
	if ( ! relations?.set ) {
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
		relations.set( ctx.windowId, ref );
	} catch {
		// Malformed ref / API rejected it — the spline is cosmetic, ignore.
	}
}

export default defineApp< AppState, AppData >( APP_ID, {
	// The frame paints the moment the window opens — the tabs (bare, no
	// counts yet), the search, ghost rows in the rail — and the
	// conversations land with `mount`.
	placeholder: () => ( {} ),

	view: ( ctx ) => {
		const { state, data } = ctx;
		const ui = ctx.ui( freshUi );
		// The rail accumulates pages under the server's key — a new tab,
		// search, scope or mutation starts it clean; a response without a
		// rail (a `select`) leaves the accumulation as it is.
		const rows =
			data.rail && data.railKey !== undefined
				? ui.list.accumulate( data.railKey, data.rail )
				: ui.list.items();
		if ( data.thread !== undefined ) {
			ui.thread = data.thread;
		}
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
					${ rail( ctx, ui, rows, data.rail?.error ?? '' ) }
					${ conversation( ctx, ui, root ) }
				</div>
				<div class="${ NS }__live screen-reader-text" role="status" aria-live="polite" data-os-comments-status>${ ui.status }</div>
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
		// of an empty circle. Once per element AND per address — the
		// renderer reuses a node positionally, so a row that lands where
		// another was must not keep the previous commenter's face.
		ctx.root.querySelectorAll< HTMLElement >( 'os-avatar[data-avatar-src]' ).forEach( ( el ) => {
			const url = el.getAttribute( 'data-avatar-src' ) ?? '';
			if ( el.getAttribute( 'data-avatar-applied' ) === url ) {
				return;
			}
			el.setAttribute( 'data-avatar-applied', url );
			if ( url ) {
				applyAvatarSrc( el, url );
			} else {
				el.removeAttribute( 'src' );
			}
		} );
		// The composer is reused positionally too: on a change of
		// conversation the draft was reset in the view, and the field's
		// own text must follow it.
		const composerFor = ctx.root.querySelector< HTMLElement >( `.${ NS }__composer[data-target]` );
		if ( composerFor && composerFor.getAttribute( 'data-composer-for' ) !== String( ui.draftFor ) ) {
			composerFor.setAttribute( 'data-composer-for', String( ui.draftFor ) );
			composerFor.querySelector< Textarea >( `.${ NS }__reply-input` )?.clear?.();
		}
		// Bodies of comments that left the thread are kept by nothing.
		pruneBodies( ui, ui.thread?.rows ?? [] );
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
