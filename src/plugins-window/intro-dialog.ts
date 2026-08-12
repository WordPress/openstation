/**
 * Plugins-window first-open intro.
 *
 * Same lifecycle / Promise-based contract as the Pages intro:
 * render a backdrop + dialog, resolve with the chosen action, tear
 * down on close. Three outcomes:
 *
 *   - `'confirm'`  — primary "Got it" button.
 *   - `'settings'` — "Take me to settings" link.
 *   - `'cancel'`   — Escape / backdrop click. Caller MUST NOT mark
 *                    seen, so the dialog re-opens next time the
 *                    window opens (lets us iterate without
 *                    resetting OS Settings between runs).
 *
 * Inline `<style>` keeps the module portable across hosts that
 * haven't enqueued the plugins-window stylesheet at boot.
 *
 * @public
 */

import { __ } from '../i18n';
import { trapFocus } from '../ui/modal-focus';

export type IntroResult = 'confirm' | 'settings' | 'cancel';

/**
 * Show the Plugins-window intro. Returns a Promise that resolves
 * with the user's chosen action.
 *
 * @param returnFocusTo Where focus lands on dismissal — the Plugins
 *                      window's root. See `showPostsIntroDialog`.
 */
export async function showPluginsIntroDialog(
	returnFocusTo?: HTMLElement | null,
): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'os-plugins-intro__backdrop';
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
		dialog.setAttribute( 'aria-labelledby', 'os-plugins-intro-title' );
		dialog.className = 'os-plugins-intro';
		Object.assign( dialog.style, {
			background: 'var(--wp-admin-theme-bg, #fff)',
			color: 'var(--wp-admin-theme-fg, #1d2327)',
			borderRadius: '14px',
			boxShadow: '0 24px 60px rgba(0,0,0,.28)',
			maxWidth: '560px',
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
			// A dialog that opened on top of this one owns Escape —
			// one keypress reaching both would close a dialog the
			// user cannot even see yet.
			if ( e.key === 'Escape' && focusScope.isTopmost() ) {
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
 * Markup for the Plugins intro dialog. Inline `<style>` so the
 * dialog is fully self-contained and renders correctly even when
 * the plugins-window stylesheet hasn't been enqueued yet (e.g. on
 * cold-open before lazy-loading completes).
 */
function renderDialogMarkup(): string {
	const title = __( 'Welcome to the new Plugins window', 'desktop-mode' );
	const lede = __(
		'You\'re looking at the redesigned Plugins admin — same WordPress.org repository under the hood, with a workflow tuned for how OpenStation wants you to work.',
		'desktop-mode',
	);

	const highlights = [
		__(
			'Two tabs in one window — Installed for managing what you have, Browse for discovering new plugins. No more bouncing between Plugins → Add New → back to Installed.',
			'desktop-mode',
		),
		__(
			'A real gallery on Browse — clean cards with rating, install count, last updated, and a click-anywhere detail flyout. Subtle hover lift, lazy-loaded icons, infinite scroll.',
			'desktop-mode',
		),
		__(
			'The detail flyout shows screenshots, the ratings histogram, recent reviews, the changelog and FAQ — all without leaving the window.',
			'desktop-mode',
		),
		__(
			'Drag a .zip onto the window to install — or drag a Browse card straight to the dock to pin a shortcut. The framework drag bridge handles the rest.',
			'desktop-mode',
		),
		__(
			'The dock repaints LIVE after every install / activate / deactivate / delete. No reload, no stale tile, no "wait, did that work?".',
			'desktop-mode',
		),
		__(
			'Per-row capability flags so the UI hides actions you can\'t perform — and the server re-validates every mutation, so flags can\'t be tampered into more permissions.',
			'desktop-mode',
		),
	];

	const li = ( arr: string[] ): string =>
		arr
			.map(
				( s ) =>
					`<li><span class="dot" aria-hidden="true"></span>${ escapeHtml(
						s,
					) }</li>`,
			)
			.join( '' );

	return `
		<style>
			.os-plugins-intro h2 {
				margin: 0 0 8px;
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.01em;
			}
			.os-plugins-intro p.lede {
				margin: 0 0 20px;
				color: var(--wp-admin-theme-fg-muted, #50575e);
				font-size: 14px;
				line-height: 1.5;
			}
			.os-plugins-intro__list {
				list-style: none;
				margin: 0 0 22px;
				padding: 0;
				font-size: 14px;
				line-height: 1.5;
			}
			.os-plugins-intro__list li {
				display: flex;
				align-items: flex-start;
				gap: 10px;
				padding: 6px 0;
			}
			.os-plugins-intro__list .dot {
				flex: 0 0 auto;
				width: 6px;
				height: 6px;
				margin-top: 9px;
				border-radius: 50%;
				background: var(--wp-admin-theme-color, #2271b1);
			}
			.os-plugins-intro__footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				margin-top: 8px;
			}
			.os-plugins-intro__footer button {
				appearance: none;
				border: 1px solid var(--wp-admin-theme-border, #dcdcde);
				background: var(--wp-admin-theme-bg, #fff);
				color: inherit;
				padding: 8px 14px;
				border-radius: 6px;
				font-size: 13px;
				cursor: pointer;
			}
			.os-plugins-intro__footer button.primary {
				border-color: var(--wp-admin-theme-color, #2271b1);
				background: var(--wp-admin-theme-color, #2271b1);
				color: #fff;
				font-weight: 500;
			}
			.os-plugins-intro__footer button:hover {
				filter: brightness(1.05);
			}
			.os-plugins-intro__footer button:focus-visible {
				outline: 2px solid var(--wp-admin-theme-color, #2271b1);
				outline-offset: 2px;
			}
		</style>
		<h2 id="os-plugins-intro-title">${ escapeHtml( title ) }</h2>
		<p class="lede">${ escapeHtml( lede ) }</p>
		<ul class="os-plugins-intro__list">${ li( highlights ) }</ul>
		<div class="os-plugins-intro__footer">
			<button type="button" data-action="settings">${ escapeHtml(
				__( 'Take me to settings', 'desktop-mode' ),
			) }</button>
			<button type="button" class="primary" data-action="confirm">${ escapeHtml(
				__( 'Got it', 'desktop-mode' ),
			) }</button>
		</div>
	`;
}

function escapeHtml( s: string ): string {
	const t = document.createElement( 'div' );
	t.textContent = s;
	return t.innerHTML;
}
