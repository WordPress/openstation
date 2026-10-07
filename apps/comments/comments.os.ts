import '../../src/ui/components/os-app-frame/os-app-frame';
import '../../src/ui/components/os-split/os-split';
import { __, createPagedList, defineApp, html } from '@openstation/app';
import { applyAvatarSrc } from '../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../src/utils';
import { NS, pruneBodies } from './parts/helpers';
import { rail, tabs } from './parts/rail';
import { conversation } from './parts/thread';
import type { AppData, AppState, CommentRow, Ctx, UiState } from './parts/types';

export type { AppData, AppState, CommentRow, CommentTab, Thread, UiState } from './parts/types';
export { normalizeStatus, statusLabel, statusTone, snippet, plainText, pickAvatarUrl, buildTree } from './parts/helpers';

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

	}
}

export default defineApp< AppState, AppData >( APP_ID, {

	placeholder: () => ( {} ),

	view: ( ctx ) => {
		const { state, data } = ctx;
		const ui = ctx.ui( freshUi );

		const rows =
			data.rail && data.railKey !== undefined
				? ui.list.accumulate( data.railKey, data.rail )
				: ui.list.items();
		if ( data.thread !== undefined ) {
			ui.thread = data.thread;
		}
		const root = rows.find( ( r ) => r.id === state.selected );

		if ( ui.draftFor !== state.selected ) {
			ui.draftFor = state.selected;
			ui.draft = '';
			ui.replyTo = 0;
			ui.editing = 0;
		}

		const pane = root ? ui.pane : 'rail';
		return html`
			<os-app-frame contained class="${ NS } ${ NS }--conversation" data-os-comments-root data-os-comments-pane=${ pane }>
				<div slot="header">${ tabs( ctx, ui ) }</div>
				<os-split class="${ NS }__split" resizable label=${ __( 'Resize conversations' ) }
					collapse-at="720" min-start="240" min-end="300"
					narrow=${ pane === 'convo' ? 'end' : 'start' }
					?compact=${ document.documentElement.dataset.osMode === 'mobile' }>
					${ rail( ctx, ui, rows, data.rail?.error ?? '' ) }
					${ conversation( ctx, ui, root ) }
				</os-split>
				<div slot="footer" class="${ NS }__live screen-reader-text" role="status" aria-live="polite" data-os-comments-status>${ ui.status }</div>
			</os-app-frame>
		`;
	},

	mounted: ( ctx ) => {
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			document.removeEventListener( 'os-mode-changed', onModeChange );
			ctx.ui( freshUi ).list.dispose();
		};
	},

	updated: ( ctx ) => {
		const ui = ctx.ui( freshUi );

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

		const composerFor = ctx.root.querySelector< HTMLElement >( `.${ NS }__composer[data-target]` );
		if ( composerFor && composerFor.getAttribute( 'data-composer-for' ) !== String( ui.draftFor ) ) {
			composerFor.setAttribute( 'data-composer-for', String( ui.draftFor ) );
			composerFor.querySelector< Textarea >( `.${ NS }__reply-input` )?.clear?.();
		}

		pruneBodies( ui, ui.thread?.rows ?? [] );

		const post = ctx.state.post;
		if ( post !== ui.announcedPost ) {
			ui.announcedPost = post;
			announcePostIdentity( ctx, post, ui.list.items()[ 0 ]?.openstation_post_title );
		}
	},
} );
