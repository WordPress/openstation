/**
 * OpenStation — Send-challenge dialog.
 *
 * `<os-modal>` hosting a `<os-user-search>` opponent picker
 * (pointed at the games-scoped search endpoint) and a summary of
 * the score being thrown down. Picked users show a presence dot via
 * `<os-avatar user-id>`, so challenging someone who's online right
 * now is one glance away.
 */

// Side-effect imports — register the `<os-*>` components this module
// constructs. `defineComponent` is idempotent across bundles.
import '../ui/components/os-avatar/os-avatar';
import '../ui/components/os-button/os-button';
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-user-search/os-user-search';

import { __, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { showToast } from '../toast';
import { createChallenge } from './rest';

interface ChallengeDialogArgs {
	game: string;
	gameTitle: string;
	score: number;
	meta: Record< string, string | number >;
}

interface PickedUser {
	id: number;
	name: string;
	avatarUrl: string;
}

function usersSearchUrl(): string {
	const globals = window as unknown as {
		openStationGamesConfig?: { usersSearchUrl?: string };
	};
	const localized = globals.openStationGamesConfig?.usersSearchUrl;
	if ( localized ) {
		return localized;
	}
	const wpGlobal = window.wp as
		| { os?: { config?: { restUrl?: string } } }
		| undefined;
	const restUrl = wpGlobal?.os?.config?.restUrl || '/wp-json/';
	return joinRestUrl( restUrl, 'desktop-mode/v1/games/users/search' );
}

/**
 * Open the dialog. Resolves when it closes (sent or cancelled).
 */
export function openChallengeDialog(
	args: ChallengeDialogArgs,
): Promise< void > {
	return new Promise( ( resolve ) => {
		const modal = document.createElement( 'os-modal' );
		modal.setAttribute( 'open', '' );
		modal.setAttribute( 'title', __( 'Send a challenge' ) );
		modal.setAttribute( 'size', 'sm' );

		const body = document.createElement( 'div' );
		body.className = 'os-games__challenge-dialog';

		const summary = document.createElement( 'p' );
		summary.className = 'os-games__challenge-summary';
		summary.textContent = sprintf(
			/* translators: 1: game title, 2: score. */
			__( 'Challenge someone to beat your %1$s score of %2$s.' ),
			args.gameTitle,
			String( args.score ),
		);
		body.appendChild( summary );

		const search = document.createElement( 'os-user-search' );
		search.setAttribute( 'placeholder', __( 'Find a player…' ) );
		search.setAttribute( 'endpoint', usersSearchUrl() );
		body.appendChild( search );

		const picked = document.createElement( 'div' );
		picked.className = 'os-games__challenge-picked';
		picked.hidden = true;
		body.appendChild( picked );

		modal.appendChild( body );

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );
		footer.className = 'os-games__challenge-footer';
		const cancel = document.createElement( 'os-button' );
		cancel.setAttribute( 'variant', 'ghost' );
		cancel.textContent = __( 'Cancel' );
		const send = document.createElement( 'os-button' );
		send.setAttribute( 'variant', 'primary' );
		send.setAttribute( 'disabled', '' );
		send.textContent = __( 'Send challenge' );
		footer.append( cancel, send );
		modal.appendChild( footer );

		let opponent: PickedUser | null = null;
		let sending = false;

		const close = (): void => {
			modal.remove();
			resolve();
		};

		const paintPicked = (): void => {
			picked.innerHTML = '';
			if ( ! opponent ) {
				picked.hidden = true;
				send.setAttribute( 'disabled', '' );
				return;
			}
			picked.hidden = false;
			const avatar = document.createElement( 'os-avatar' );
			avatar.setAttribute( 'src', opponent.avatarUrl );
			avatar.setAttribute( 'name', opponent.name );
			avatar.setAttribute( 'size', 'sm' );
			avatar.setAttribute( 'user-id', String( opponent.id ) );
			picked.appendChild( avatar );
			const name = document.createElement( 'span' );
			name.textContent = opponent.name;
			picked.appendChild( name );
			send.removeAttribute( 'disabled' );
		};

		search.addEventListener( 'os-user-pick', ( e: Event ) => {
			const user = ( e as CustomEvent< { user?: PickedUser } > ).detail
				?.user;
			if ( user ) {
				opponent = user;
				paintPicked();
			}
		} );

		cancel.addEventListener( 'click', close );
		modal.addEventListener( 'os-modal-cancel', close );

		send.addEventListener( 'click', () => {
			if ( ! opponent || sending ) {
				return;
			}
			sending = true;
			send.setAttribute( 'disabled', '' );
			void createChallenge( {
				game: args.game,
				recipientId: opponent.id,
				score: args.score,
				meta: args.meta,
			} )
				.then( () => {
					showToast( {
						message: sprintf(
							/* translators: %s: opponent display name. */
							__( 'Challenge sent to %s.' ),
							opponent!.name,
						),
					} );
					close();
				} )
				.catch( ( err ) => {
					sending = false;
					send.removeAttribute( 'disabled' );
					showToast( {
						message:
							err instanceof Error
								? err.message
								: __( 'Could not send the challenge.' ),
					} );
				} );
		} );

		document.body.appendChild( modal );
	} );
}
