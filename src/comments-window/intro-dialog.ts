/**
 * Comments-window first-open intro dialog.
 *
 * A lightweight, static modal — no Pixi this time, the wow-effect
 * lives inside the window itself (the moderation queue + keyboard
 * shortcuts). Reuses the same lifecycle / outcome model as the
 * Posts-window intro.
 *
 * @public
 */

import { __ } from '../i18n';

export type IntroResult = 'confirm' | 'settings' | 'cancel';

interface HighlightItem {
	icon: string;
	title: string;
	body: string;
}

const HIGHLIGHTS: HighlightItem[] = [
	{
		icon: 'dashicons-yes-alt',
		title: __( 'Triage in one place' ),
		body: __(
			'Pending / All / Spam / Trash / Mine tabs — every status surface in a single window with live counts.',
		),
	},
	{
		icon: 'dashicons-controls-repeat',
		title: __( 'Bulk moderation with undo' ),
		body: __(
			'Multi-select and approve, spam, or trash dozens at once. Every action shows an 8-second undo toast.',
		),
	},
	{
		icon: 'dashicons-format-chat',
		title: __( 'Inline reply' ),
		body: __(
			'Reply right inside the row — no modal, no full-page navigation. Press R on any row to jump straight to the editor.',
		),
	},
	{
		icon: 'dashicons-warning',
		title: __( 'Spam confidence score' ),
		body: __(
			'Every comment gets a 0–100 score from Akismet + heuristics. Optionally turn on AI scoring in OS Settings → Features so each new comment is also scored by your configured AI provider on arrival.',
		),
	},
	{
		icon: 'dashicons-admin-users',
		title: __( 'Author insights drawer' ),
		body: __(
			'Click an avatar to see the author\'s full history — total comments, spam rate, first seen, and one-click block.',
		),
	},
	{
		icon: 'dashicons-keyboard-hide',
		title: __( 'Keyboard moderation' ),
		body: __(
			'J/K to navigate, A approve, S spam, D trash, R reply, E edit, U undo. Press ? any time for the cheat sheet.',
		),
	},
];

export async function showCommentsIntroDialog(): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'wpd-intro-backdrop';
		const dialog = document.createElement( 'div' );
		dialog.className = 'wpd-intro wpd-intro--comments';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'wpd-comments-intro-title' );
		dialog.tabIndex = -1;
		backdrop.appendChild( dialog );

		const titleEl = document.createElement( 'h2' );
		titleEl.id = 'wpd-comments-intro-title';
		titleEl.className = 'wpd-intro__title';
		titleEl.textContent = __( 'Welcome to the new Comments' );
		dialog.appendChild( titleEl );

		const lede = document.createElement( 'p' );
		lede.className = 'wpd-intro__lede';
		lede.textContent = __(
			'A moderation surface built around how you actually triage: bulk actions with undo, an inline reply editor, keyboard shortcuts, and a spam score that surfaces the obvious junk first.',
		);
		dialog.appendChild( lede );

		const grid = document.createElement( 'div' );
		grid.className = 'wpd-intro__grid';
		HIGHLIGHTS.forEach( ( h ) => {
			const card = document.createElement( 'div' );
			card.className = 'wpd-intro__card';
			const icon = document.createElement( 'span' );
			icon.className = `dashicons ${ h.icon } wpd-intro__card-icon`;
			icon.setAttribute( 'aria-hidden', 'true' );
			const heading = document.createElement( 'h3' );
			heading.className = 'wpd-intro__card-title';
			heading.textContent = h.title;
			const body = document.createElement( 'p' );
			body.className = 'wpd-intro__card-body';
			body.textContent = h.body;
			card.append( icon, heading, body );
			grid.appendChild( card );
		} );
		dialog.appendChild( grid );

		const escape = document.createElement( 'p' );
		escape.className = 'wpd-intro__escape';
		escape.textContent = __(
			'Prefer the classic Comments screen? You can switch back any time from OS Settings → Features.',
		);
		dialog.appendChild( escape );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-intro__actions';
		const settingsBtn = document.createElement( 'button' );
		settingsBtn.type = 'button';
		settingsBtn.className = 'wpd-intro__btn wpd-intro__btn--secondary';
		settingsBtn.textContent = __( 'Take me to settings' );
		const confirmBtn = document.createElement( 'button' );
		confirmBtn.type = 'button';
		confirmBtn.className = 'wpd-intro__btn wpd-intro__btn--primary';
		confirmBtn.textContent = __( 'Let me moderate' );
		actions.append( settingsBtn, confirmBtn );
		dialog.appendChild( actions );

		document.body.appendChild( backdrop );

		const cleanup = ( result: IntroResult ): void => {
			document.removeEventListener( 'keydown', onKey );
			backdrop.remove();
			resolve( result );
		};
		const onKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				cleanup( 'cancel' );
			}
		};
		document.addEventListener( 'keydown', onKey );

		confirmBtn.addEventListener( 'click', () => cleanup( 'confirm' ) );
		settingsBtn.addEventListener( 'click', () => cleanup( 'settings' ) );
		backdrop.addEventListener( 'click', ( e ) => {
			if ( e.target === backdrop ) {
				cleanup( 'cancel' );
			}
		} );

		requestAnimationFrame( () => dialog.focus() );
	} );
}
