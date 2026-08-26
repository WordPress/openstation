/**
 * `<os-user-profile user-id="N">` — full WordPress user profile
 * surface as a single drop-in custom element.
 *
 * Renders the same UX you get from `wp-admin/user-edit.php` — and
 * more — built from the existing mount functions in
 * `./user-edit-render`:
 *
 *   - **Sidebar** — avatar, name, role chips, profile-completeness
 *     bar, KPI tiles, 12-month posts sparkline.
 *   - **Form** — every editable field (identity, contact, bio,
 *     language, role, password + confirm, personal options,
 *     admin colour swatch picker, sessions destroy button,
 *     application passwords list).
 *   - **Activity feed** — recent posts, recent comments,
 *     sessions, app-password summary.
 *
 * ### Usage
 *
 * ```html
 * <os-user-profile user-id="3"></os-user-profile>
 * ```
 *
 * Set or change the `user-id` attribute at any time; the component
 * (re-)mounts the profile for the new id without losing layout.
 *
 * Light-DOM rendering — the component creates its layout shell as
 * direct children, then hands them to the existing mount functions
 * (`mountProfileFormAt`, `mountProfileAsideAt`,
 * `mountProfileActivityAt`). Mounts work via `replaceChildren`,
 * which only works on real DOM children, so light DOM is the
 * right call here.
 *
 * @public
 */

interface UserEditMounts {
	mountProfileFormAt( host: HTMLElement, userId: number ): Promise< unknown >;
	mountProfileAsideAt(
		host: HTMLElement,
		userId: number,
		fresh: boolean,
	): Promise< void >;
	mountProfileActivityAt(
		host: HTMLElement,
		userId: number,
		fresh: boolean,
	): Promise< void >;
}

let _mountsPromise: Promise< UserEditMounts > | null = null;
function loadMounts(): Promise< UserEditMounts > {
	if ( ! _mountsPromise ) {
		_mountsPromise = import( './user-edit-render' ) as Promise<
			unknown
		> as Promise< UserEditMounts >;
	}
	return _mountsPromise;
}

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
		void this._mountIfNeeded();
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		if ( name !== 'user-id' || oldValue === newValue ) {
			return;
		}
		if ( this._initialized ) {
			void this._mountIfNeeded();
		}
	}

	/**
	 * Build the layout shell (sidebar + main column + activity
	 * region). Same class names as the inline Profile tab in the
	 * Users window so the existing posts-window.css rules style
	 * both contexts identically.
	 */
	private _renderShell(): void {
		this.classList.add( 'os-user-profile' );
		// Class anchors the existing scoped CSS in posts-window.css.
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

	private async _mountIfNeeded(): Promise< void > {
		const userIdAttr = this.getAttribute( 'user-id' );
		const userId = userIdAttr ? parseInt( userIdAttr, 10 ) : 0;
		if ( ! Number.isFinite( userId ) || userId <= 0 ) {
			return;
		}
		if ( userId === this._mountedFor ) {
			return;
		}
		this._mountedFor = userId;

		const formHost = this.querySelector< HTMLElement >(
			'[data-os-user-profile-form]',
		);
		const asideHost = this.querySelector< HTMLElement >(
			'[data-os-user-profile-aside]',
		);
		const activityHost = this.querySelector< HTMLElement >(
			'[data-os-user-profile-activity]',
		);
		if ( ! formHost || ! asideHost || ! activityHost ) {
			return;
		}

		const mounts = await loadMounts();
		void mounts.mountProfileFormAt( formHost, userId );
		void mounts.mountProfileAsideAt( asideHost, userId, false );
		void mounts.mountProfileActivityAt( activityHost, userId, false );
	}
}

if ( typeof customElements !== 'undefined' && ! customElements.get( 'os-user-profile' ) ) {
	customElements.define( 'os-user-profile', OsUserProfile );
}
