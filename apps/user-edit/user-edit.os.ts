/**
 * User Edit — the client view of the profile editor.
 *
 * The body is `<os-user-profile>` on the state's user id — the element
 * the companion bundle `apps/users/profile/` defines — fed this app's
 * facts, REST access and toast as properties from `updated()`. The id
 * comes from the window's open-time params (`mount`), and changes
 * through the `reopen` lifecycle when the live singleton is asked to
 * open on someone else; flipping the attribute re-mounts the profile
 * in place.
 *
 * @public
 */

import { defineApp, html } from '@openstation/app';
import type { OsUserProfile, ProfileConfig } from '../users/profile/index';

interface State extends Record< string, unknown > {
	userId: number;
}

interface Data {
	userId: number;
}

/** How long a toast dwells: errors longer, so the reason can be read. */
const TOAST_MS: Record< string, number | undefined > = { success: 5000, error: 8000, info: undefined };

export default defineApp< State, Data >( 'desktop-mode-user-edit', {
	view: ( { state } ) => html`<div class="os-user-edit-window" data-os-user-edit-window-root>
		<os-user-profile
			os-preserve
			data-os-user-profile-host
			user-id=${ state.userId > 0 ? String( state.userId ) : '' }
		></os-user-profile>
	</div>`,

	updated: ( ctx ) => {
		const ui = ctx.ui( () => ( { wired: false } ) );
		const profile = ctx.root.querySelector< OsUserProfile >( 'os-user-profile' );
		if ( ! profile || ui.wired ) {
			return;
		}
		ui.wired = true;
		profile.config = ctx.extra as ProfileConfig;
		profile.fetch = ctx.fetch;
		profile.toast = ( message, kind ) => ctx.host.toast?.( { message, duration: TOAST_MS[ kind ?? 'info' ] } );
	},
} );
