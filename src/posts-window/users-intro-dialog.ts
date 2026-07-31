/**
 * Users-window first-open intro.
 *
 * Plain CSS, no animations, no PixiJS — same posture as the Pages
 * intro. Returns the standard `IntroResult` (`'confirm' | 'settings'
 * | 'cancel'`) Promise so the slug-driven seen-mark flow in
 * `users-render.ts` can route the outcome the same way Posts /
 * Pages do.
 *
 * @public
 */

import { __ } from '../i18n';

export type IntroResult = 'confirm' | 'settings' | 'cancel';

export async function showUsersIntroDialog(): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'desktop-mode-users-intro__backdrop';
		backdrop.setAttribute( 'role', 'presentation' );
		Object.assign( backdrop.style, {
			position: 'fixed',
			inset: '0',
			background:
				'color-mix(in srgb, var(--wp-admin-theme-color, #1d2327) 60%, transparent)',
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
		dialog.setAttribute(
			'aria-labelledby',
			'desktop-mode-users-intro-title',
		);
		dialog.className = 'desktop-mode-users-intro';
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
		primaryBtn?.focus();

		let resolved = false;
		const cleanup = ( result: IntroResult ): void => {
			if ( resolved ) {
				return;
			}
			resolved = true;
			document.removeEventListener( 'keydown', onKey, true );
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

function renderDialogMarkup(): string {
	const title = __( 'Welcome to the new Users window' );
	const lede = __(
		'Same data you already manage, with the polish the Users list has been waiting for.',
	);

	const highlights = [
		__( 'Live online indicator on every row — see who is around right now.' ),
		__( 'Last-login column so you finally know who is actually using the site.' ),
		__( 'Bulk role change with strict role-permission enforcement — never accidentally promote anyone above your own level.' ),
		__( 'One-click password reset and resend-welcome buttons, with sensible rate-limiting.' ),
		__( 'Click-to-copy email and a long-overdue search that matches name, username, AND email.' ),
		__( 'Per-user content stats: posts, pages, comments at a glance.' ),
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
			.desktop-mode-users-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.desktop-mode-users-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-users-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.desktop-mode-users-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.desktop-mode-users-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.desktop-mode-users-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.desktop-mode-users-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.desktop-mode-users-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.desktop-mode-users-intro__footer button:hover { filter: brightness(1.05); }
			.desktop-mode-users-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="desktop-mode-users-intro-title">${ escapeHtml( title ) }</h2>
		<p class="lede">${ escapeHtml( lede ) }</p>
		<ul class="desktop-mode-users-intro__list">${ li( highlights ) }</ul>
		<div class="desktop-mode-users-intro__footer">
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
