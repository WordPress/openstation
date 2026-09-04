/**
 * Comments app — the conversation pane: the head, the nested thread
 * with its per-message actions and inline editor, and the docked
 * reply composer.
 *
 * Part of the `comments` client view: imported by the `comments.os.ts`
 * entry.
 *
 * @public
 */

import { __, html, type TemplateResult } from '@openstation/app';
import { osIcon } from '../../../src/ui/icons';
import { decodeHTML } from '../../../src/utils';
import {
	DESTRUCTIVE,
	NS,
	actionResultLabel,
	adminUrl,
	authorName,
	avatar,
	bodyNode,
	emptyState,
	externalIcon,
	normalizeStatus,
	plainText,
	statusBadge,
	timestamp,
	treeFor,
} from './helpers';
import type { AppExtra, BulkAction, CommentRow, Ctx, UiState } from './types';

type Textarea = HTMLElement & { focusInput?: () => void; clear?: () => void };

function extra( ctx: Ctx ): AppExtra {
	return ctx.extra as AppExtra;
}

/**
 * Push a short sentence into the window's polite live region. Cleared
 * first and set on the next tick: a screen reader announces a live
 * region on a DOM change, and the same sentence twice in a row (two
 * approvals) is no change at all.
 */
export function announce( ctx: Ctx, ui: UiState, text: string ): void {
	ui.status = '';
	ctx.repaint();
	window.setTimeout( () => {
		ui.status = text;
		ctx.repaint();
	}, 0 );
}

/** Read from the textarea the runtime's events wrote into `ui`. */
function draftValue( e: Event ): string {
	return String( ( e as CustomEvent< { value?: string } > ).detail?.value ?? '' );
}

// ------------------------------------------------------------- actions

async function moderate( ctx: Ctx, ui: UiState, id: number, action: BulkAction ): Promise< void > {
	ui.busy = `${ id }:${ action }`;
	ctx.repaint();
	const ok = await ctx.dispatch(
		'moderate',
		{ ids: [ id ], action },
		{ confirm: DESTRUCTIVE[ action ] ?? null },
	);
	ui.busy = '';
	if ( ok ) {
		announce( ctx, ui, actionResultLabel( action ) );
	} else {
		ctx.repaint();
	}
}

/** The per-message Reply button repoints the composer and focuses it. */
function openComposerFor( ctx: Ctx, ui: UiState, target: CommentRow ): void {
	ui.replyTo = target.id;
	ctx.repaint();
	const box = ctx.root.querySelector< HTMLElement >( `.${ NS }__composer` );
	box?.querySelector< Textarea >( `.${ NS }__reply-input` )?.focusInput?.();
	box?.scrollIntoView?.( { block: 'nearest', behavior: 'smooth' } );
}

function openInlineEdit( ctx: Ctx, ui: UiState, row: CommentRow ): void {
	// Re-entrancy: a second Edit click on the open message just refocuses.
	if ( ui.editing !== row.id ) {
		ui.editing = row.id;
		// The seed is bound once, when the editor mounts; the draft
		// tracks the keystrokes. Binding the draft back would re-set the
		// textarea's value under the caret on every repaint.
		ui.editSeed = plainText( row );
		ui.editDraft = ui.editSeed;
		ctx.repaint();
	}
	ctx.root
		.querySelector< Textarea >( `.${ NS }__msg[data-id="${ row.id }"] > .${ NS }__msg-body > .${ NS }__reply-input` )
		?.focusInput?.();
}

async function saveEdit( ctx: Ctx, ui: UiState, row: CommentRow ): Promise< void > {
	const value = ui.editDraft.trim();
	if ( ! value ) {
		ctx.host.toast?.( { message: __( 'A comment cannot be empty.' ) } );
		return;
	}
	ui.busy = `edit:${ row.id }`;
	ctx.repaint();
	const ok = await ctx.dispatch( 'edit', { id: row.id, content: value } );
	ui.busy = '';
	if ( ok ) {
		ui.editing = 0;
		announce( ctx, ui, __( 'Comment updated.' ) );
	} else {
		ctx.repaint();
	}
}

async function sendReply( ctx: Ctx, ui: UiState, root: CommentRow ): Promise< void > {
	if ( ui.busy === 'reply' ) {
		return;
	}
	const value = ui.draft.trim();
	if ( ! value ) {
		ctx.host.toast?.( { message: __( 'Reply is empty.' ) } );
		return;
	}
	ui.busy = 'reply';
	ctx.repaint();
	const ok = await ctx.dispatch( 'reply', { parent: ui.replyTo || root.id, content: value } );
	ui.busy = '';
	if ( ok ) {
		ui.draft = '';
		ctx.root.querySelector< Textarea >( `.${ NS }__composer .${ NS }__reply-input` )?.clear?.();
		announce( ctx, ui, __( 'Reply sent.' ) );
	} else {
		ctx.repaint();
	}
}

// --------------------------------------------------------------- pieces

/**
 * One action in the per-message row — `<os-button variant="link">`,
 * the chrome-less variant, so the row reads as wp-admin's own comment
 * row actions: plain links, pipe separators, red for the two that take
 * a comment out of the conversation.
 */
function actionButton(
	label: string,
	tone: 'default' | 'danger',
	busy: boolean,
	onClick: () => void,
): TemplateResult {
	return html`<os-button
		class="${ NS }__act${ tone === 'danger' ? ' is-danger' : '' }"
		variant="link"
		?busy=${ busy }
		?disabled=${ busy }
		@click=${ ( e: Event ) => {
			e.stopPropagation();
			onClick();
		} }
	>${ label }</os-button>`;
}

function messageActions( ctx: Ctx, ui: UiState, row: CommentRow ): TemplateResult {
	const status = normalizeStatus( row );
	const canModerate = !! extra( ctx ).canModerate;
	const canReply = !! extra( ctx ).canEditComments;
	const busyOn = ( action: string ): boolean => ui.busy === `${ row.id }:${ action }`;

	// Order mirrors wp-admin's comment row actions: the moderation verb
	// first, then the authoring verbs, then the two destructive ones.
	const items: TemplateResult[] = [];
	if ( canModerate ) {
		const approveAction: BulkAction = status === 'approved' ? 'unapprove' : 'approve';
		items.push(
			actionButton(
				status === 'approved' ? __( 'Unapprove' ) : __( 'Approve' ),
				'default',
				busyOn( approveAction ),
				() => void moderate( ctx, ui, row.id, approveAction ),
			),
		);
	}
	// Replying posts a comment — gated on `edit_posts`, the cap the
	// reply action and route enforce (the parent's post is re-checked
	// server-side), so the action isn't offered to someone it will 403.
	if ( canReply ) {
		items.push( actionButton( __( 'Reply' ), 'default', false, () => openComposerFor( ctx, ui, row ) ) );
	}
	if ( row.openstation_can_edit ) {
		items.push( actionButton( __( 'Edit' ), 'default', false, () => openInlineEdit( ctx, ui, row ) ) );
	}
	if ( canModerate ) {
		if ( status !== 'spam' ) {
			items.push( actionButton( __( 'Spam' ), 'danger', busyOn( 'spam' ), () => void moderate( ctx, ui, row.id, 'spam' ) ) );
		}
		if ( status !== 'trash' ) {
			items.push( actionButton( __( 'Trash' ), 'danger', busyOn( 'trash' ), () => void moderate( ctx, ui, row.id, 'trash' ) ) );
		}
	}
	// The pipe separators are real nodes: every `<os-button>` is a shadow
	// host, and generated content on a host is at the mercy of flat-tree
	// slotting. Built here, they land between whichever actions this
	// viewer actually got, with none dangling at either end.
	return html`<div class="${ NS }__msg-actions" ?hidden=${ ui.editing === row.id }>${ items.map(
		( item, index ) =>
			index > 0
				? html`<span class="${ NS }__act-sep" aria-hidden="true">|</span>${ item }`
				: item,
	) }</div>`;
}

/** The inline editor under a message, while `ui.editing` is it. */
function inlineEditor( ctx: Ctx, ui: UiState, row: CommentRow ): TemplateResult {
	const busy = ui.busy === `edit:${ row.id }`;
	const cancel = (): void => {
		ui.editing = 0;
		ctx.repaint();
	};
	return html`<os-textarea
			class="${ NS }__reply-input"
			placeholder=${ __( 'Edit comment…' ) }
			aria-label=${ __( 'Comment text' ) }
			rows="4"
			auto-grow
			max-rows="10"
			value=${ ui.editSeed }
			?disabled=${ busy }
			@os-input-change=${ ( e: Event ) => {
				ui.editDraft = draftValue( e );
			} }
			@os-input-commit=${ ( e: Event ) => {
				ui.editDraft = draftValue( e );
			} }
		></os-textarea>
		<div class="${ NS }__composer-row ${ NS }__edit-bar">
			<os-button variant="ghost" @click=${ cancel }>${ __( 'Cancel' ) }</os-button>
			<os-button variant="primary" ?busy=${ busy } ?disabled=${ busy } @click=${ () => void saveEdit( ctx, ui, row ) }>${ __( 'Save' ) }</os-button>
		</div>`;
}

function message( ctx: Ctx, ui: UiState, row: CommentRow, byParent: Map< number, CommentRow[] > ): TemplateResult {
	const children = byParent.get( row.id ) ?? [];
	const status = normalizeStatus( row );
	const editing = ui.editing === row.id;
	const body = bodyNode( ui, row );
	body.hidden = editing;
	return html`<div class="${ NS }__msg" data-id=${ row.id } data-status=${ status }>
		<div class="${ NS }__msg-rail">
			${ avatar( row, 34 ) }
			${ children.length > 0 ? html`<div class="${ NS }__msg-line"></div>` : '' }
		</div>
		<div class="${ NS }__msg-body">
			<div class="${ NS }__msg-head">
				<span class="${ NS }__msg-name">${ authorName( row ) }</span>
				${ row.author > 0 && row.author === extra( ctx ).currentUserId
					? html`<os-badge class="${ NS }__msg-you" tone="info" no-dot>${ __( 'You' ) }</os-badge>`
					: '' }
				${ timestamp( row.date_gmt, `${ NS }__msg-time` ) }
				${ status !== 'approved' ? statusBadge( status ) : '' }
			</div>
			${ body }
			${ messageActions( ctx, ui, row ) }
			${ editing ? inlineEditor( ctx, ui, row ) : '' }
			${ children.length > 0
				? html`<div class="${ NS }__nested">${ children.map( ( child ) => message( ctx, ui, child, byParent ) ) }</div>`
				: '' }
		</div>
	</div>`;
}

function convoHead( ctx: Ctx, ui: UiState, root: CommentRow ): TemplateResult {
	const title = decodeHTML( root.openstation_post_title || __( '(no title)' ) );
	const back = (): void => {
		ui.pane = 'rail';
		ctx.repaint();
	};
	// The title IS the edit affordance — a same-origin wp-admin link the
	// shell's link interceptor catches and mounts as a window. The pencil
	// and the tooltip are the hint that it is clickable.
	const post =
		root.post > 0
			? html`<a
				class="${ NS }__convo-post ${ NS }__convo-post--editable"
				href="${ adminUrl() }post.php?post=${ root.post }&action=edit"
				title=${ __( 'Edit this post' ) }
			>${ title }<os-icon class="${ NS }__convo-post-pencil" name="edit" size="15"></os-icon><span class="screen-reader-text">${ __( 'Edit this post' ) }</span></a>`
			: html`<div class="${ NS }__convo-post">${ title }</div>`;
	return html`<div class="${ NS }__convo-head">
		<os-button
			class="${ NS }__convo-back"
			variant="ghost"
			aria-label=${ __( 'Back to conversations' ) }
			title=${ __( 'Back to conversations' ) }
			@click=${ back }
		>${ osIcon( 'chevron-right', { size: 18, rotate: 180 } ) }</os-button>
		<div class="${ NS }__convo-context">
			<div class="${ NS }__convo-kicker">${ __( 'In response to' ) }</div>
			${ post }
		</div>
		<div class="${ NS }__convo-head-actions">
			${ root.openstation_post_link
				? html`<a class="${ NS }__convo-link" href=${ root.openstation_post_link } target="_blank" rel="noopener">${ __( 'View post' ) }${ externalIcon() }<span class="screen-reader-text">${ __( '(opens in a new tab)' ) }</span></a>`
				: '' }
		</div>
	</div>`;
}

function composer( ctx: Ctx, ui: UiState, root: CommentRow, rows: CommentRow[] ): TemplateResult {
	if ( ! extra( ctx ).canEditComments ) {
		// Nothing to compose with — the reply action would refuse it.
		return html`<div class="${ NS }__composer is-empty" data-target=${ root.id }></div>`;
	}
	const target = rows.find( ( r ) => r.id === ui.replyTo ) ?? root;
	const busy = ui.busy === 'reply';
	return html`<div class="${ NS }__composer" data-target=${ target.id }>
		<div class="${ NS }__composer-to">${ __( 'Replying to' ) } <b>${ authorName( target ) }</b></div>
		<os-textarea
			class="${ NS }__reply-input"
			placeholder=${ __( 'Write a reply…' ) }
			aria-label=${ __( 'Reply' ) }
			rows="3"
			auto-grow
			max-rows="10"
			submit-on-enter
			?disabled=${ busy }
			@os-input-change=${ ( e: Event ) => {
				ui.draft = draftValue( e );
			} }
			@os-input-commit=${ ( e: Event ) => {
				ui.draft = draftValue( e );
			} }
			@os-submit=${ ( e: Event ) => {
				ui.draft = draftValue( e );
				void sendReply( ctx, ui, root );
			} }
		></os-textarea>
		<div class="${ NS }__composer-row">
			<span class="${ NS }__composer-hint">${ __( 'Enter to send · Shift+Enter for a new line' ) }</span>
			<os-button variant="primary" ?busy=${ busy } ?disabled=${ busy } @click=${ () => void sendReply( ctx, ui, root ) }>${ __( 'Send reply' ) }</os-button>
		</div>
	</div>`;
}

/**
 * The conversation pane: the placeholder when nothing is selected,
 * otherwise the head, the scrolling thread and the composer. The
 * thread rows are the last ones received (`ui.thread`); when that
 * read failed the root alone is painted.
 */
export function conversation( ctx: Ctx, ui: UiState, root: CommentRow | undefined ): TemplateResult {
	if ( ! root ) {
		return html`<section class="${ NS }__convo" data-os-comments-convo>${ emptyState(
			'format-chat',
			__( 'No conversation selected' ),
			__( 'Pick one from the list to read and reply.' ),
		) }</section>`;
	}
	const rows = ui.thread?.rows ?? [ root ];
	const byParent = treeFor( ui, rows );
	const rootRow = rows.find( ( r ) => r.id === root.id ) ?? root;
	return html`<section class="${ NS }__convo" data-os-comments-convo>
		${ convoHead( ctx, ui, rootRow ) }
		<div class="${ NS }__thread-scroll">
			${ message( ctx, ui, rootRow, byParent ) }
			${ ui.thread?.truncated
				? html`<os-notice class="${ NS }__truncated" tone="info">${ __( 'This conversation is longer than shown; open the post to read the rest.' ) }</os-notice>`
				: '' }
		</div>
		${ composer( ctx, ui, rootRow, rows ) }
	</section>`;
}
