/**
 * Extensions marketplace section.
 *
 * Lists Desktop Mode extensions advertised by the configured release
 * manifest and lets the user install / activate / deactivate / update /
 * delete each one. Multisite subsite admins (read-only) get the same
 * catalog without the action buttons.
 *
 * REST surface (see `includes/marketplace/rest.php`):
 *
 *   GET  <marketplaceUrl>/extensions
 *   POST <marketplaceUrl>/refresh
 *   POST <marketplaceUrl>/{install,update,activate,deactivate,delete}
 */

import { __, sprintf } from '../../../i18n';
import { html, render } from '../../../ui/core';
import type { SettingsCtx } from '../../types';
import type {
	MarketplaceAction,
	MarketplaceExtension,
	MarketplaceListResponse,
	MarketplaceState,
} from './types';

export function buildExtensionsSection( ctx: SettingsCtx ): HTMLElement {
	const { marketplaceUrl, restNonce } = ctx.config;

	const state: MarketplaceState = {
		loading: true,
		error: '',
		data: null,
		busy: new Set(),
	};

	const el = document.createElement( 'div' );

	const fetchJson = async (
		path: string,
		init?: RequestInit,
	): Promise< unknown > => {
		const url = `${ marketplaceUrl }/${ path.replace( /^\//, '' ) }`;
		const res = await fetch( url, {
			...init,
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': restNonce,
				...( init?.headers ?? {} ),
			},
		} );
		if ( ! res.ok ) {
			const body = ( await res.json().catch( () => ( {} ) ) ) as {
				message?: string;
				code?: string;
			};
			throw new Error( body.message ?? `HTTP ${ res.status }` );
		}
		return res.json();
	};

	const load = async ( opts: { refresh?: boolean } = {} ): Promise< void > => {
		state.loading = true;
		state.error = '';
		paint();
		try {
			if ( opts.refresh ) {
				await fetchJson( 'refresh', { method: 'POST' } );
			}
			const data = ( await fetchJson( 'extensions' ) ) as MarketplaceListResponse;
			state.data = data;
		} catch ( err ) {
			state.error = err instanceof Error ? err.message : String( err );
		} finally {
			state.loading = false;
			paint();
		}
	};

	const mutate = async (
		slug: string,
		action: MarketplaceAction,
	): Promise< void > => {
		if ( state.busy.has( slug ) ) {
			return;
		}
		state.busy.add( slug );
		state.error = '';
		paint();
		try {
			const result = ( await fetchJson( action, {
				method: 'POST',
				body: JSON.stringify( { slug } ),
			} ) ) as { extension: MarketplaceExtension };

			if ( state.data && result?.extension ) {
				const idx = state.data.extensions.findIndex( ( e ) => e.slug === slug );
				if ( idx >= 0 ) {
					state.data.extensions[ idx ] = result.extension;
				}
			}

			// Live-refresh the shell so the new plugin's dock items,
			// native windows, widgets, etc. appear without a hard
			// reload. The `/wp-desktop/v1/menu` endpoint polyfills admin
			// context internally so just-activated plugins register
			// their hooks before the payload is built.
			try {
				await window.wp?.desktop?.refreshMenu?.();
			} catch {
				/* Refresh failures degrade gracefully — the user can
				 * still hard-reload to see the change. Don't surface
				 * this as an error in the marketplace UI. */
			}
		} catch ( err ) {
			state.error = err instanceof Error ? err.message : String( err );
		} finally {
			state.busy.delete( slug );
			paint();
		}
	};

	const renderActions = (
		ext: MarketplaceExtension,
		canModify: boolean,
	): ReturnType< typeof html > => {
		if ( ! canModify ) {
			return html`<span class="wp-desktop-marketplace__readonly"
				>${ __( 'Read-only' ) }</span
			>`;
		}
		const busy = state.busy.has( ext.slug );
		const buttons: ReturnType< typeof html >[] = [];

		if ( ! ext.installed ) {
			buttons.push(
				html`<wpd-button
					variant="primary"
					?disabled=${ busy || ext.incompatible_environment }
					@click=${ () => mutate( ext.slug, 'install' ) }
					>${ busy ? __( 'Installing…' ) : __( 'Install' ) }</wpd-button
				>`,
			);
		} else if ( ext.active ) {
			buttons.push(
				html`<wpd-button
					variant="ghost"
					?disabled=${ busy }
					@click=${ () => mutate( ext.slug, 'deactivate' ) }
					>${ busy ? __( 'Working…' ) : __( 'Deactivate' ) }</wpd-button
				>`,
			);
		} else {
			buttons.push(
				html`<wpd-button
					variant="primary"
					?disabled=${ busy || ext.incompatible_environment }
					@click=${ () => mutate( ext.slug, 'activate' ) }
					>${ busy ? __( 'Working…' ) : __( 'Activate' ) }</wpd-button
				>`,
			);
			buttons.push(
				html`<wpd-button
					variant="ghost"
					?disabled=${ busy }
					@click=${ () => mutate( ext.slug, 'delete' ) }
					>${ __( 'Delete' ) }</wpd-button
				>`,
			);
		}

		return html`<div class="wp-desktop-marketplace__actions">${ buttons }</div>`;
	};

	const renderUpdateBanner = (
		ext: MarketplaceExtension,
		canModify: boolean,
	): ReturnType< typeof html > => {
		if ( ! ext.needs_update || ! ext.installed ) {
			return html``;
		}
		const versionLine = sprintf(
			/* translators: 1: installed version, 2: available version */
			__( 'v%1$s → v%2$s' ),
			ext.installed_version ?? '?',
			ext.version ?? '?',
		);
		const busy = state.busy.has( ext.slug );
		return html`<div class="wp-desktop-marketplace__update">
			<span class="wp-desktop-marketplace__update-line"
				>${ __( 'Update available' ) } · ${ versionLine }</span
			>
			${ canModify
				? html`<wpd-button
					variant="primary"
					size="small"
					?disabled=${ busy }
					@click=${ () => mutate( ext.slug, 'update' ) }
					>${ busy ? __( 'Updating…' ) : __( 'Update' ) }</wpd-button
				>`
				: html`` }
		</div>`;
	};

	const renderStatus = (
		ext: MarketplaceExtension,
	): ReturnType< typeof html > => {
		if ( ext.active ) {
			return html`<span class="wp-desktop-marketplace__badge wp-desktop-marketplace__badge--active"
				>${ __( 'Active' ) }</span
			>`;
		}
		if ( ext.installed ) {
			return html`<span class="wp-desktop-marketplace__badge wp-desktop-marketplace__badge--inactive"
				>${ __( 'Inactive' ) }</span
			>`;
		}
		return html`<span class="wp-desktop-marketplace__badge"
			>${ __( 'Available' ) }</span
		>`;
	};

	const renderCard = (
		ext: MarketplaceExtension,
		canModify: boolean,
	): ReturnType< typeof html > => {
		const incompatibleNote = ext.incompatible_environment
			? html`<p class="wp-desktop-marketplace__warning">
					${ sprintf(
						/* translators: %s: list of supported environments */
						__( 'This extension targets %s only and is hidden from action buttons in this environment.' ),
						( ext.environments ?? [] ).join( ', ' ),
					) }
				</p>`
			: html``;

		return html`<article class="wp-desktop-marketplace__card">
			<header class="wp-desktop-marketplace__card-head">
				<div class="wp-desktop-marketplace__title-block">
					<h4 class="wp-desktop-marketplace__name">
						${ ext.name }
						${ ext.version
							? html`<span class="wp-desktop-marketplace__version"
								>v${ ext.version }</span
							>`
							: html`` }
					</h4>
					${ renderStatus( ext ) }
				</div>
				${ renderActions( ext, canModify ) }
			</header>
			<p class="wp-desktop-marketplace__desc">${ ext.short_description }</p>
			${ incompatibleNote }
			${ renderUpdateBanner( ext, canModify ) }
			${ ext.homepage
				? html`<p class="wp-desktop-marketplace__links">
						<a href=${ ext.homepage } target="_blank" rel="noreferrer noopener"
							>${ __( 'View on GitHub' ) }</a
						>
					</p>`
				: html`` }
		</article>`;
	};

	const onRefresh = (): void => {
		void load( { refresh: true } );
	};

	const paint = (): void => {
		const data = state.data;
		const canModify = data?.can_modify ?? false;

		let body: ReturnType< typeof html >;
		if ( state.loading && ! data ) {
			body = html`<p class="wp-desktop-marketplace__hint"
				>${ __( 'Loading extensions…' ) }</p
			>`;
		} else if ( state.error && ! data ) {
			body = html`<p class="wp-desktop-marketplace__error">${ state.error }</p>`;
		} else if ( ! data || data.extensions.length === 0 ) {
			body = html`<p class="wp-desktop-marketplace__hint"
				>${ __( 'No extensions available.' ) }</p
			>`;
		} else {
			body = html`<div class="wp-desktop-marketplace__grid">
				${ data.extensions.map( ( ext ) => renderCard( ext, canModify ) ) }
			</div>`;
		}

		const readOnlyNotice =
			data && ! data.can_modify
				? html`<p class="wp-desktop-marketplace__hint">
						${ __(
							'You can browse extensions, but installing them requires the install_plugins capability — on multisite, that means a Super Admin.',
						) }
					</p>`
				: html``;

		const persistentError =
			state.error && data
				? html`<p class="wp-desktop-marketplace__error">${ state.error }</p>`
				: html``;

		render(
			html`
				<wpd-section
					heading=${ __( 'Extensions' ) }
					description=${ __(
						'Install Desktop Mode extensions published to the official release manifest. Each entry is a standard WordPress plugin that depends on Desktop Mode.',
					) }
				>
					<div class="wp-desktop-marketplace__toolbar">
						<wpd-button
							variant="ghost"
							?disabled=${ state.loading }
							@click=${ onRefresh }
							>${ state.loading ? __( 'Refreshing…' ) : __( 'Refresh' ) }</wpd-button
						>
					</div>
					${ readOnlyNotice }
					${ persistentError }
					${ body }
				</wpd-section>
			`,
			el,
		);
	};

	paint();
	void load();

	return el;
}
