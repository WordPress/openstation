/**
 * Users app — the "Send email" compose modal.
 *
 * One user, a subject and a plain-text message. The draft is
 * client-only: it lives in the window's UI state and reaches the
 * server only as the `send-email` action's args. The modal closes when
 * the server bumped `emailsSent`; any other answer keeps it open with
 * the draft intact and the reason in a notice.
 */

import { __, html, sprintf, type TemplateResult, type ViewContext } from '@openstation/app';
import type { UserListItem, UsersData, UsersState } from './types';

type Ctx = ViewContext< UsersState, UsersData >;

/** The open draft. */
export interface ComposeDraft {
	row: UserListItem;
	subject: string;
	message: string;
	/** A send is in flight — Send stays disabled. */
	sending: boolean;
	/** The last failed send's reason. */
	error: string;
}

/** The UI state field the modal reads and writes. */
export interface ComposeHost {
	compose: ComposeDraft | null;
}

const ready = ( draft: ComposeDraft ): boolean =>
	draft.subject.trim() !== '' && draft.message.trim() !== '';

/** Open a fresh draft for one user: empty fields, no error. */
export function openCompose( ctx: Ctx, host: ComposeHost, row: UserListItem ): void {
	host.compose = { row, subject: '', message: '', sending: false, error: '' };
	ctx.repaint();
}

async function send( ctx: Ctx, host: ComposeHost, draft: ComposeDraft ): Promise< void > {
	if ( draft.sending || ! ready( draft ) ) {
		return;
	}
	const before = ctx.state.emailsSent;
	draft.sending = true;
	ctx.repaint();
	const ok = await ctx.dispatch( 'send-email', { id: draft.row.id, subject: draft.subject, message: draft.message } );
	if ( host.compose !== draft ) {
		return;
	}
	if ( ctx.state.emailsSent > before ) {
		host.compose = null;
	} else {
		draft.sending = false;
		// A network error has no state answer; its toast already said why.
		draft.error = ok ? ctx.state.emailError : '';
	}
	ctx.repaint();
}

/** The modal, while a draft is open. */
export function composeModal( ctx: Ctx, host: ComposeHost ): TemplateResult | '' {
	const draft = host.compose;
	if ( ! draft ) {
		return '';
	}
	const close = (): void => {
		host.compose = null;
		ctx.repaint();
	};
	// Repaint only when Send's availability flips, not on every keystroke.
	const edit = ( field: 'subject' | 'message' ) => ( e: Event ): void => {
		const was = ready( draft );
		draft[ field ] = String( ( e as CustomEvent< { value?: string } > ).detail?.value ?? '' );
		if ( ready( draft ) !== was ) {
			ctx.repaint();
		}
	};
	return html`
		<os-modal
			open
			size="sm"
			title=${ sprintf(
				/* translators: %s is a user's display name. */
				__( 'Email %s' ),
				draft.row.name,
			) }
			data-os-users-compose
			@os-modal-cancel=${ close }
		>
			<div class="os-users__compose">
				<p class="os-users__compose-to">${ draft.row.email ?? '' }</p>
				${ draft.error ? html`<os-notice tone="danger" not-dismissible>${ draft.error }</os-notice>` : '' }
				<os-text-field
					label=${ __( 'Subject' ) }
					maxlength="200"
					value=${ draft.subject }
					@os-input-change=${ edit( 'subject' ) }
				></os-text-field>
				<os-textarea
					label=${ __( 'Message' ) }
					rows="8"
					maxlength="5000"
					value=${ draft.message }
					@os-input-change=${ edit( 'message' ) }
				></os-textarea>
			</div>
			<div slot="footer">
				<os-button variant="ghost" @click=${ close }>${ __( 'Cancel' ) }</os-button>
				<os-button
					variant="primary"
					?disabled=${ draft.sending || ! ready( draft ) }
					@click=${ () => void send( ctx, host, draft ) }
				>${ __( 'Send' ) }</os-button>
			</div>
		</os-modal>
	`;
}
