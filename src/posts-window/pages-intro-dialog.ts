/**
 * Pages-window first-open intro.
 *
 * Same lifecycle / Promise-based contract as
 * {@link showPostsIntroDialog}: render a backdrop + dialog, resolve
 * with the chosen action, tear down on close. Three outcomes:
 * `'confirm'` ("Got it"), `'settings'` ("Take me to settings"), or
 * `'cancel'` (Escape / backdrop click — caller MUST NOT mark seen).
 *
 * Deliberately plain — no PixiJS, no hero animation. The Pages
 * window's value is straightforward UX polish, so the dialog
 * matches: a short welcome, a few highlights, two buttons.
 *
 * @public
 */

import { __ } from '../i18n';
import { trapFocus } from '../ui/modal-focus';

/**
 * Outcome of the dialog. Mirrors `IntroResult` in `./intro-dialog.ts`.
 */
export type IntroResult = 'confirm' | 'settings' | 'cancel';

/**
 * Show the Pages-window intro. Returns a Promise that resolves with
 * the user's chosen action.
 *
 * @param returnFocusTo Where focus lands on dismissal — the Pages
 *                      window's root. See {@link showPostsIntroDialog}.
 */
export async function showPagesIntroDialog(
	returnFocusTo?: HTMLElement | null,
): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'os-pages-intro__backdrop';
		backdrop.setAttribute( 'role', 'presentation' );
		Object.assign( backdrop.style, {
			position: 'fixed',
			inset: '0',
			background: 'color-mix(in srgb, var(--wp-admin-theme-color, #1d2327) 60%, transparent)',
			backdropFilter: 'blur(2px)',
			zIndex: '100000',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '24px',
		} as Partial< CSSStyleDeclaration > );

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'os-pages-intro-title' );
		dialog.className = 'os-pages-intro';
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
			// Before the removal — see `showPostsIntroDialog`.
			focusScope.release();
			backdrop.remove();
			resolve( result );
		};

		const onKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				cleanup( 'cancel' );
			}
		};
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
 * Markup for the Pages intro dialog. Inline `<style>` keeps the
 * module portable across hosts that haven't enqueued the Posts
 * stylesheet.
 */
function renderDialogMarkup(): string {
	const title = __( 'Welcome to the new Pages window' );
	const lede = __(
		"You're looking at the redesigned Pages list — same data you already manage, with a UX tuned for how OpenStation wants you to work.",
	);

	const highlights = [
		__( 'Sticky header and sticky title column so long lists stay readable as you scroll.' ),
		__( 'Front page and Posts page badges right on the title — no more "wait, which one is the homepage?".' ),
		__( 'Page Template column so you can spot which template each page uses at a glance.' ),
		__( 'Slug column with one-click copy — perfect when configuring redirects or sharing canonical URLs.' ),
		__( 'Comments column, Parent column, View link, lock indicator, multi-select bulk actions, inline search, status segments. All in one screen, no reloads.' ),
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
			.os-pages-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.os-pages-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.os-pages-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.os-pages-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.os-pages-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.os-pages-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.os-pages-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.os-pages-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.os-pages-intro__footer button:hover { filter: brightness(1.05); }
			.os-pages-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="os-pages-intro-title">${ escapeHtml( title ) }</h2>
		<p class="lede">${ escapeHtml( lede ) }</p>
		<ul class="os-pages-intro__list">${ li( highlights ) }</ul>
		<div class="os-pages-intro__footer">
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
