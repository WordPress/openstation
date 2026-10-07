import { shellToast } from '../../../src/core/shell-toast';
import { joinRestUrl } from '../../../src/rest-url';
import { trackedFetch } from '../../../src/tracked-fetch';
import { fetchInsights } from './client';
import { mountProfileFormAt } from './form';
import { paintActivity, paintAside, paintInsightsError, paintInsightsLoading } from './insights';
import type { ProfileConfig, ProfileHost } from './types';

export type { ProfileConfig, ProfileHost } from './types';

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

	get config(): ProfileConfig {
		return this._config;
	}
	set config( value: ProfileConfig ) {
		this._config = value ?? {};
		this._schedule();
	}

	get fetch(): ProfileHost[ 'fetch' ] | null {
		return this._fetch;
	}
	set fetch( value: ProfileHost[ 'fetch' ] | null ) {
		this._fetch = value;
		this._schedule();
	}

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

	host(): ProfileHost {
		return {
			config: this._config,
			fetch: this._fetch ?? shellFetch,
			toast: this._toast ?? ( ( message: string ) => {
				shellToast( { message } );
			} ),
		};
	}

	refreshInsights(): Promise< void > {
		return this._loadInsights( this._generation, true );
	}

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
