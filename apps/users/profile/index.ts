/**
 * `<os-user-profile user-id="N">` — the full WordPress user profile
 * surface as one drop-in custom element: the sidebar summary, the
 * editable form and the activity feed of `wp-admin/user-edit.php`.
 *
 * Hosted by the User Edit app (the whole window) and by the Users
 * app's Profile tab (the viewer's own profile), which set the
 * element's PROPERTIES from `updated()`:
 *
 *   - `config` — the profile facts (`ctx.extra`: roles, locales,
 *     colour schemes, contact methods, the viewer's id);
 *   - `fetch`  — a REST fetch over a relative path (`ctx.fetch`: the
 *     nonce and the window attribution ride along);
 *   - `toast`  — `( message, kind? )`.
 *
 * A bare element with none of them falls back to the shell's REST
 * root, nonce and toast. Set or change `user-id` at any time; the
 * element (re-)mounts the profile for the new id without losing the
 * layout, fetching the record and the insights ONCE each and painting
 * the aside and the activity feed from the same payload. Light-DOM
 * rendering: the layout shell is direct children the mount functions
 * work on with `replaceChildren`.
 *
 * Built as its own bundle (`assets/js/apps/user-profile[.min].js`,
 * the `openstation-user-profile` companion of both windows); the
 * definition is guarded so a second load never redefines the tag.
 *
 * @public
 */

import { joinRestUrl } from '../../../src/rest-url';
import { trackedFetch } from '../../../src/tracked-fetch';
import { fetchInsights } from './client';
import { mountProfileFormAt } from './form';
import { paintActivity, paintAside, paintInsightsError, paintInsightsLoading } from './insights';
import type { ProfileConfig, ProfileHost } from './types';

export type { ProfileConfig, ProfileHost } from './types';

/** The shell's REST root + nonce, for an element no app is feeding. */
function shellFetch( path: string, init: RequestInit = {} ): Promise< Response > {
	const cfg = ( window as unknown as { openStationConfig?: { restRoot?: string; restNonce?: string } } ).openStationConfig ?? {};
	const headers = new Headers( init.headers );
	if ( ! headers.has( 'Accept' ) ) {
		headers.set( 'Accept', 'application/json' );
	}
	if ( cfg.restNonce && ! headers.has( 'X-WP-Nonce' ) ) {
		headers.set( 'X-WP-Nonce', cfg.restNonce );
	}
	return trackedFetch( joinRestUrl( String( cfg.restRoot ?? '' ), path ), { credentials: 'same-origin', ...init, headers }, { source: 'user-profile' } );
}

function shellToast( message: string ): void {
	window.wp?.os?.showToast?.( { message } );
}

export class OsUserProfile extends HTMLElement {
	static get observedAttributes(): string[] {
		return [ 'user-id' ];
	}

	private _config: ProfileConfig = {};
	private _fetch: ProfileHost[ 'fetch' ] | null = null;
	private _toast: ProfileHost[ 'toast' ] | null = null;
	private _shellReady = false;
	private _mountedFor: number | null = null;
	private _generation = 0;
	private _scheduled = false;

	/** The profile facts. Setting them (re-)evaluates the mount. */
	get config(): ProfileConfig {
		return this._config;
	}
	set config( value: ProfileConfig ) {
		this._config = value ?? {};
		this._schedule();
	}

	/** REST over a relative path — the hosting app's `ctx.fetch`. */
	get fetch(): ProfileHost[ 'fetch' ] | null {
		return this._fetch;
	}
	set fetch( value: ProfileHost[ 'fetch' ] | null ) {
		this._fetch = value;
		this._schedule();
	}

	/** `( message, kind? )` — the hosting app's toast. */
	get toast(): ProfileHost[ 'toast' ] | null {
		return this._toast;
	}
	set toast( value: ProfileHost[ 'toast' ] | null ) {
		this._toast = value;
	}

	connectedCallback(): void {
		if ( ! this._shellReady ) {
			this._shellReady = true;
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
		this._schedule();
	}

	attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void {
		if ( name === 'user-id' && oldValue !== newValue ) {
			this._schedule();
		}
	}

	/** The host contract as the element sees it now. */
	host(): ProfileHost {
		return {
			config: this._config,
			fetch: this._fetch ?? shellFetch,
			toast: this._toast ?? shellToast,
		};
	}

	/** Re-fetch the insights (fresh) and repaint this element's own aside and feed — after a save. */
	refreshInsights(): Promise< void > {
		return this._loadInsights( this._generation, true );
	}

	/**
	 * Mount on a microtask, never synchronously: a hosting app appends
	 * the element with `user-id` already set and assigns the properties
	 * right after, in `updated()` — the same task. Deferring lets those
	 * land before the first fetch goes out under the right window.
	 */
	private _schedule(): void {
		if ( this._scheduled ) {
			return;
		}
		this._scheduled = true;
		queueMicrotask( () => {
			this._scheduled = false;
			this._mountIfNeeded();
		} );
	}

	private _mountIfNeeded(): void {
		if ( ! this._shellReady || ! this.isConnected ) {
			return;
		}
		const userId = parseInt( this.getAttribute( 'user-id' ) ?? '0', 10 );
		if ( ! Number.isFinite( userId ) || userId <= 0 || userId === this._mountedFor ) {
			return;
		}
		this._mountedFor = userId;
		const generation = ++this._generation;
		const formHost = this.querySelector< HTMLElement >( '[data-os-user-profile-form]' );
		if ( ! formHost ) {
			return;
		}
		void mountProfileFormAt( formHost, userId, this.host(), {
			onSaved: () => {
				if ( generation === this._generation ) {
					void this.refreshInsights();
				}
			},
		} ).catch( () => undefined );
		void this._loadInsights( generation, false );
	}

	private async _loadInsights( generation: number, fresh: boolean ): Promise< void > {
		const aside = this.querySelector< HTMLElement >( '[data-os-user-profile-aside]' );
		const activity = this.querySelector< HTMLElement >( '[data-os-user-profile-activity]' );
		const userId = this._mountedFor;
		if ( ! aside || ! activity || ! userId ) {
			return;
		}
		paintInsightsLoading( aside );
		paintInsightsLoading( activity );
		try {
			const data = await fetchInsights( this.host(), userId, fresh );
			// A retarget while the request was out: that mount paints its own.
			if ( generation !== this._generation ) {
				return;
			}
			paintAside( aside, data, this._config );
			paintActivity( activity, data );
		} catch ( err ) {
			if ( generation !== this._generation ) {
				return;
			}
			paintInsightsError( aside, err );
			paintInsightsError( activity, err );
		}
	}
}

if ( typeof customElements !== 'undefined' && ! customElements.get( 'os-user-profile' ) ) {
	customElements.define( 'os-user-profile', OsUserProfile );
}
