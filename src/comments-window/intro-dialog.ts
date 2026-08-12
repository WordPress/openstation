/**
 * Comments-window first-open intro.
 *
 * Same lifecycle / Promise-based contract as the Pages and Users
 * intros: render a backdrop + dialog, resolve with the chosen action,
 * tear down on close. Three outcomes: `'confirm'` ("Got it"),
 * `'settings'` ("Take me to settings"), or `'cancel'` (Escape /
 * backdrop click — the caller MUST NOT mark seen, so the dialog
 * re-opens next time and design iteration doesn't require resetting
 * OpenStation Preferences between runs).
 *
 * Deliberately plain — no PixiJS, no hero animation. What the window
 * changed is the *shape* of moderation (a thread you read, rather
 * than a table you scan), and a static list of what moved says that
 * faster than a demo would.
 *
 * Inline `<style>` keeps the module self-contained, so the dialog
 * renders correctly even on a cold open where the comments-window
 * stylesheet hasn't landed yet.
 *
 * @public
 */

import { __ } from '../i18n';
import { trapFocus } from '../ui/modal-focus';

/** Outcome of the dialog. Mirrors `IntroResult` in the Posts window. */
export type IntroResult = 'confirm' | 'settings' | 'cancel';

/**
 * Show the Comments-window intro.
 *
 * @param returnFocusTo Where focus lands on dismissal — the Comments
 *                      window's root. The dialog opens itself as the
 *                      window paints, so there is no launcher to
 *                      return to and the default (whatever the user
 *                      last touched) would park them outside the
 *                      window they just opened.
 */
export async function showCommentsIntroDialog(
	returnFocusTo?: HTMLElement | null,
): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'os-comments-intro__backdrop';
		backdrop.setAttribute( 'role', 'presentation' );
		Object.assign( backdrop.style, {
			position: 'fixed',
			inset: '0',
			background:
				'color-mix(in srgb, var(--wp-admin-theme-color, #1d2327) 60%, transparent)',
			backdropFilter: 'blur(2px)',
			WebkitBackdropFilter: 'blur(2px)',
			zIndex: '100000',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '24px',
		} as Partial< CSSStyleDeclaration > );

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'os-comments-intro-title' );
		dialog.className = 'os-comments-intro';
		Object.assign( dialog.style, {
			background: 'var(--wp-admin-theme-bg, #fff)',
			color: 'var(--wp-admin-theme-fg, #1d2327)',
			borderRadius: '14px',
			boxShadow: '0 24px 60px rgba(0,0,0,.28)',
			maxWidth: '520px',
			width: '100%',
			maxHeight: '90vh',
			overflow: 'auto',
			padding: '28px 32px 24px',
			fontFamily:
				'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
		} as Partial< CSSStyleDeclaration > );

		dialog.innerHTML = renderDialogMarkup();
		backdrop.appendChild( dialog );
		document.body.appendChild( backdrop );

		const primaryBtn = dialog.querySelector< HTMLButtonElement >(
			'[data-action="confirm"]',
		);
		const settingsBtn = dialog.querySelector< HTMLButtonElement >(
			'[data-action="settings"]',
		);

		// Opens on "Got it" and holds Tab inside the dialog until it
		// closes, then hands focus to the window it introduced.
		const focusScope = trapFocus( {
			root: dialog,
			initialFocus: primaryBtn,
			returnFocusTo,
		} );

		let resolved = false;
		const cleanup = ( result: IntroResult ): void => {
			if ( resolved ) {
				return;
			}
			resolved = true;
			document.removeEventListener( 'keydown', onKey, true );
			// Before the removal — once the dialog is out of the
			// document the browser has already dropped focus on
			// `<body>` and there is nothing to hand back from.
			focusScope.release();
			backdrop.remove();
			resolve( result );
		};

		const onKey = ( e: KeyboardEvent ): void => {
			// A dialog that opened on top of this one owns Escape —
			// one keypress reaching both would close a dialog the
			// user cannot even see yet.
			if ( e.key === 'Escape' && focusScope.isTopmost() ) {
				e.preventDefault();
				cleanup( 'cancel' );
			}
		};
		// Capture phase so the shell's own global key handlers don't
		// get the Escape first.
		document.addEventListener( 'keydown', onKey, true );

		backdrop.addEventListener( 'click', ( e ) => {
			if ( e.target === backdrop ) {
				cleanup( 'cancel' );
			}
		} );

		primaryBtn?.addEventListener( 'click', () => cleanup( 'confirm' ) );
		settingsBtn?.addEventListener( 'click', () => cleanup( 'settings' ) );
	} );
}

/**
 * Markup for the Comments intro dialog. Every string describes
 * something the window actually does today — a first-run dialog is
 * the one place a user has no way to check the claim against the UI
 * yet, so it does not get to promise anything the window doesn't do.
 */
function renderDialogMarkup(): string {
	const title = __( 'Welcome to the new Comments window' );
	const lede = __(
		'Moderation as a conversation rather than a table: pick a thread on the left, read the whole exchange on the right, and act on any message without leaving the window.',
	);

	const highlights = [
		__( 'Two panes — a rail of conversations beside the selected thread, so a reply is never separated from what it was replying to.' ),
		__( 'The full nested chain, however deep it goes. No more one-level threading that hides who answered whom.' ),
		__( 'Pending, All, Spam, Trash and Mine tabs with live counts — every moderation queue in one window.' ),
		__( 'Reply and edit in place through a docked composer, with approve, spam and trash on every message including nested replies.' ),
		__( 'Search across the rail, and open a post\'s comments straight from its editor to scope the window to that one conversation.' ),
	];

	const li = ( arr: string[] ): string =>
		arr
			.map(
				( s ) =>
					`<li><span class="dot" aria-hidden="true"></span>${ escapeHtml( s ) }</li>`,
			)
			.join( '' );

	return `
		<style>
			.os-comments-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.os-comments-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.os-comments-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.os-comments-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.os-comments-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.os-comments-intro__escape {
				margin: 0 0 16px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 13px;
				line-height: 1.5;
			}
			.os-comments-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.os-comments-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.os-comments-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.os-comments-intro__footer button:hover { filter: brightness(1.05); }
			.os-comments-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="os-comments-intro-title">${ escapeHtml( title ) }</h2>
		<p class="lede">${ escapeHtml( lede ) }</p>
		<ul class="os-comments-intro__list">${ li( highlights ) }</ul>
		<p class="os-comments-intro__escape">${ escapeHtml(
			__( 'Prefer the classic Comments screen? You can switch back any time from OpenStation Preferences → Features.' ),
		) }</p>
		<div class="os-comments-intro__footer">
			<button type="button" data-action="settings">${ escapeHtml(
				__( 'Take me to settings' ),
			) }</button>
			<button type="button" class="primary" data-action="confirm">${ escapeHtml(
				__( 'Got it' ),
			) }</button>
		</div>
	`;
}

function escapeHtml( s: string ): string {
	const t = document.createElement( 'div' );
	t.textContent = s;
	return t.innerHTML;
}
