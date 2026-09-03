/**
 * `<os-user-profile user-id="N">` — the full WordPress user profile
 * surface as one drop-in custom element: the sidebar summary, the
 * editable form and the activity feed of `wp-admin/user-edit.php`,
 * and more.
 *
 * Hosted by the User Edit app (the whole window) and by the Users
 * app's Profile tab (the viewer's own profile). Set or change the
 * `user-id` attribute at any time; the component (re-)mounts the
 * profile for the new id without losing layout. Light-DOM rendering:
 * the layout shell is direct children handed to the mount functions,
 * which work through `replaceChildren` on real DOM nodes.
 *
 * Both app bundles import this part; the definition is guarded so the
 * second bundle to load never redefines the tag.
 *
 * @public
 */

import { mountProfileFormAt } from './profile-form';
import { mountProfileActivityAt, mountProfileAsideAt } from './profile-insights';

export class OsUserProfile extends HTMLElement {
	static get observedAttributes(): string[] {
		return [ 'user-id' ];
	}

	private _initialized = false;
	private _mountedFor: number | null = null;

	connectedCallback(): void {
		if ( ! this._initialized ) {
			this._initialized = true;
			this._renderShell();
		}
		this._mountIfNeeded();
	}

	attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void {
		if ( name === 'user-id' && oldValue !== newValue && this._initialized ) {
			this._mountIfNeeded();
		}
	}

	/** The layout shell: sidebar + main column + activity region. Same class names in both hosts. */
	private _renderShell(): void {
		this.classList.add( 'os-user-profile' );
		this.innerHTML = `
			<div class="os-users__edit-layout" data-os-user-profile-layout>
				<aside class="os-users__edit-aside" data-os-user-profile-aside></aside>
				<main class="os-users__edit-main">
					<div data-os-user-profile-form></div>
					<div class="os-users__edit-activity" data-os-user-profile-activity></div>
				</main>
			</div>
		`;
	}

	private _mountIfNeeded(): void {
		const userId = parseInt( this.getAttribute( 'user-id' ) ?? '0', 10 );
		if ( ! Number.isFinite( userId ) || userId <= 0 || userId === this._mountedFor ) {
			return;
		}
		this._mountedFor = userId;
		const formHost = this.querySelector< HTMLElement >( '[data-os-user-profile-form]' );
		const asideHost = this.querySelector< HTMLElement >( '[data-os-user-profile-aside]' );
		const activityHost = this.querySelector< HTMLElement >( '[data-os-user-profile-activity]' );
		if ( ! formHost || ! asideHost || ! activityHost ) {
			return;
		}
		void mountProfileFormAt( formHost, userId ).catch( () => undefined );
		void mountProfileAsideAt( asideHost, userId, false );
		void mountProfileActivityAt( activityHost, userId, false );
	}
}

if ( typeof customElements !== 'undefined' && ! customElements.get( 'os-user-profile' ) ) {
	customElements.define( 'os-user-profile', OsUserProfile );
}
