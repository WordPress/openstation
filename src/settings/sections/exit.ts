/**
 * Exit Desktop Mode section — clearly labeled affordance to switch back
 * to classic WP admin from inside OS Settings.
 *
 * Lives at the bottom of the Appearance tab. The admin-bar toggle
 * (`includes/admin-bar.php` + `assets/js/admin-bar.js`) is the original
 * exit path; this is a more discoverable mirror of the same action for
 * users who don't think of the admin bar as "settings."
 *
 * Implementation: reuses the existing `save-desktop-mode` admin-ajax
 * endpoint via the `desktopModeAdminBar` global already published by the
 * admin-bar inline script (same nonce, same endpoint, same redirect
 * shape). No new PHP surface, no new REST route. If the global isn't
 * available for some reason (admin bar suppressed by a third party,
 * etc.), we fall back to navigating to `adminUrl` from the shell config,
 * which lands in classic admin and lets the user re-enable on next
 * load.
 *
 * @since 0.18.x
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';

/**
 * Shape of the global published by `includes/admin-bar.php` →
 * `wp_add_inline_script( 'desktop-mode-admin-bar', 'var desktopModeAdminBar = …' )`.
 * Matches the consumer in `assets/js/admin-bar.js`.
 */
interface DesktopModeAdminBarConfig {
	nonce?: string;
	active?: boolean;
	classicUrl?: string;
	portalUrl?: string;
	ajaxUrl?: string;
}

declare global {
	interface Window {
		desktopModeAdminBar?: DesktopModeAdminBarConfig;
	}
}

export function buildExitSection(): HTMLElement {
	const el = document.createElement( 'div' );
	el.classList.add( 'desktop-mode-os-settings__exit' );

	let busy = false;
	let error = '';

	const navigate = ( url: string ): void => {
		// Mirror the admin-bar handler — drive the whole tab, not just
		// the shell window, in case anything ever embeds OS Settings in
		// an iframe.
		try {
			if ( window.top ) {
				window.top.location.href = url;
				return;
			}
		} catch {
			// Cross-origin — fall through.
		}
		window.location.href = url;
	};

	const onClick = (): void => {
		if ( busy ) {
			return;
		}
		const cfg = window.desktopModeAdminBar;
		const fallbackUrl =
			window.desktopModeConfig?.adminUrl || '/wp-admin/';

		// No admin-bar global on the page — best-effort: navigate
		// straight to classic admin. The user can re-enable from there.
		// This path also hits when something has actively suppressed
		// the admin bar (chromeless iframes do, but OS Settings doesn't
		// run in one).
		if ( ! cfg || ! cfg.ajaxUrl || ! cfg.nonce ) {
			navigate( cfg?.classicUrl || fallbackUrl );
			return;
		}

		busy = true;
		error = '';
		paint();

		const body = new URLSearchParams();
		body.set( 'action', 'save-desktop-mode' );
		body.set( 'nonce', cfg.nonce );
		body.set( 'enabled', '' );

		fetch( cfg.ajaxUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			credentials: 'same-origin',
			body: body.toString(),
		} )
			.then( async ( res ) => {
				if ( ! res.ok ) {
					throw new Error( `HTTP ${ res.status }` );
				}
				const json = ( await res.json().catch( () => null ) ) as
					| { success?: boolean; data?: { redirect?: string } }
					| null;
				const target = json?.data?.redirect || cfg.classicUrl || fallbackUrl;
				navigate( target );
			} )
			.catch( () => {
				busy = false;
				error = __(
					'Could not switch back to classic admin. Check your connection and try again.',
				);
				paint();
			} );
	};

	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Exit Desktop Mode' ) }
					description=${ __(
						'Switch back to the standard WordPress admin. You can return to Desktop Mode from the admin bar at any time.',
					) }
				>
					<wpd-button
						variant="secondary"
						?busy=${ busy }
						?disabled=${ busy }
						@click=${ onClick }
					>
						${ busy
							? __( 'Switching…' )
							: __( 'Switch to Classic Admin' ) }
					</wpd-button>
					${ error
						? html`<p class="desktop-mode-os-settings__exit-error" role="alert">
								${ error }
							</p>`
						: html`` }
				</wpd-section>
			`,
			el,
		);

	paint();
	return el;
}
