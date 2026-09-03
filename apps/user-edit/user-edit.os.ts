/**
 * User Edit — the client view of the profile editor.
 *
 * The body is `<os-user-profile>` on the state's user id — the same
 * element the Users app's Profile tab hosts (`apps/users/parts/`),
 * which reads its facts (roles, locales, colour schemes) from this
 * app's config. The id comes from the window's open-time params
 * (`mount`), and changes through the `reopen` lifecycle when the live
 * singleton is asked to open on someone else; flipping the attribute
 * re-mounts the profile in place, as it always did.
 *
 * @public
 */

import { defineApp, html } from '@openstation/app';
import '../users/parts/os-user-profile';

interface State extends Record< string, unknown > {
	userId: number;
}

interface Data {
	userId: number;
}

export default defineApp< State, Data >( 'desktop-mode-user-edit', {
	view: ( { state } ) => html`<div class="os-user-edit-window" data-os-user-edit-window-root>
		<os-user-profile
			os-preserve
			data-os-user-profile-host
			user-id=${ state.userId > 0 ? String( state.userId ) : '' }
		></os-user-profile>
	</div>`,
} );
