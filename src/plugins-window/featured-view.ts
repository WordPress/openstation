/**
 * Native Plugins window — "Desktop Mode plugins" tab.
 *
 * A curated + auto-discovered gallery of plugins that integrate with
 * Desktop Mode. Curated entries (hand-picked because wp.org has no
 * real `requires_plugins` filter) lead the list; rows whose wp.org
 * `requires_plugins` array contains the `desktop-mode` slug are
 * appended after.
 *
 * Single server fetch per mount — the AJAX endpoint owns the curated
 * list + discovery + transient caching. No infinite scroll, no
 * search, no filter: the surface is small by design.
 *
 * @public
 * @since 0.8.6
 */

import { __, sprintf } from '../i18n';
import { broadcast, subscribe } from '../broadcast';
import {
	buildCard,
	repaintCardCta,
	type CardCallbacks,
	type InstalledIndex,
} from './card';
import { makeCardDraggable } from './card-drag';
import { openDetailFlyout } from './flyout-detail';
import {
	activateInstalledPlugin,
	fetchFeaturedPlugins,
	fetchInstalledPlugins,
	installPluginBySlug,
	refreshFrameworkMenu,
	type FeaturedPlugin,
} from './rest';
import type { InstalledPlugin } from './types';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-card/wpd-card';
import '../ui/components/wpd-ribbon/wpd-ribbon';

/**
 * Cross-view sync topic. Mirrors the contract in `browse-view.ts` /
 * `installed-view.ts` so the Featured tab also gets repainted when
 * another tab mutates a plugin's installed state.
 *
 * @internal
 */
const PLUGINS_CHANGED_TOPIC = 'desktop-mode.plugin.changed';
const SOURCE = 'featured-view';
interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'bulk';
}

interface FeaturedState {
	plugins: FeaturedPlugin[];
	installed: InstalledIndex;
	cardsBySlug: Map< string, HTMLElement >;
	loading: boolean;
}

/** Toast helper — mirrors the other views. */
function toast( message: string, duration = 3500 ): void {
	const api = window.wp?.desktop;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( { message, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.log( '[plugins-window]', message );
}

/**
 * Mount the Featured view into a host element. Returns a teardown
 * for the framework's window-closed cleanup pattern.
 */
export function mountFeaturedView(
	host: HTMLElement,
	flyoutEl: HTMLElement | null,
): () => void {
	host.replaceChildren();

	const state: FeaturedState = {
		plugins: [],
		installed: new Map(),
		cardsBySlug: new Map(),
		loading: true,
	};

	// ─── Intro blurb ───────────────────────────────────────────────────
	const intro = document.createElement( 'header' );
	intro.className = 'desktop-mode-plugins__featured-intro';
	const heading = document.createElement( 'h2' );
	heading.className = 'desktop-mode-plugins__featured-heading';
	heading.textContent = __( 'Made for Desktop Mode', 'desktop-mode' );
	const description = document.createElement( 'p' );
	description.className = 'desktop-mode-plugins__featured-blurb';
	description.textContent = __(
		'Plugins that extend Desktop Mode — desktop decorations, native windows, widgets, and other companions.',
		'desktop-mode',
	);
	intro.append( heading, description );

	// ─── Gallery ───────────────────────────────────────────────────────
	const gallery = document.createElement( 'div' );
	gallery.className = 'desktop-mode-plugins__gallery';

	const status = document.createElement( 'p' );
	status.className = 'desktop-mode-plugins__gallery-status';
	status.hidden = true;

	host.append( intro, gallery, status );

	// ─── Card callbacks ────────────────────────────────────────────────
	const cardCallbacks: CardCallbacks = {
		onOpen: ( slug, hint ) => {
			if ( ! flyoutEl ) {
				return;
			}
			openDetailFlyout( flyoutEl, slug, hint, {
				getInstalled: ( s ) => state.installed.get( s ),
				onPluginInstalled: async ( pluginFile, slug2 ) => {
					await refreshInstalled();
					repaintSlugCard( slug2 );
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: pluginFile ?? slug2,
						action: 'install',
					} );
				},
				onPluginActivated: ( updated ) => {
					state.installed.set( indexKeyFor( updated ), updated );
					repaintSlugCard( updated.textdomain ?? '' );
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: updated.plugin,
						action: 'activate',
					} );
				},
				onPluginDeactivated: ( updated ) => {
					state.installed.set( indexKeyFor( updated ), updated );
					repaintSlugCard( updated.textdomain ?? '' );
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: updated.plugin,
						action: 'deactivate',
					} );
				},
				onPluginDeleted: ( deleted ) => {
					state.installed.delete( indexKeyFor( deleted ) );
					repaintSlugCard( deleted.textdomain ?? '' );
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: deleted.plugin,
						action: 'delete',
					} );
				},
			} );
		},
		onInstall: async ( plugin, card ) => {
			const cta = card.querySelector< HTMLElement >( '[data-plugin-card-cta]' );
			const originalText = cta?.textContent ?? '';
			cta?.setAttribute( 'busy', '' );
			cta?.setAttribute( 'disabled', '' );
			if ( cta ) {
				cta.textContent = __( 'Installing…', 'desktop-mode' );
			}
			try {
				await installPluginBySlug( plugin.slug );
				await refreshInstalled();
				toast(
					sprintf(
						/* translators: %s: plugin name */
						__( 'Installed %s.', 'desktop-mode' ),
						plugin.name,
					),
				);
				repaintCardCta( card, plugin, state.installed, cardCallbacks );
				broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
					source: SOURCE,
					plugin: plugin.slug,
					action: 'install',
				} );
				void refreshFrameworkMenu();
			} catch ( err ) {
				cta?.removeAttribute( 'busy' );
				cta?.removeAttribute( 'disabled' );
				if ( cta ) {
					cta.textContent = originalText;
				}
				toast(
					sprintf(
						/* translators: %s: error message */
						__( 'Install failed: %s', 'desktop-mode' ),
						formatError( err ),
					),
					6000,
				);
			}
		},
		onActivate: async ( installed, card ) => {
			const cta = card.querySelector< HTMLElement >( '[data-plugin-card-cta]' );
			const originalText = cta?.textContent ?? '';
			cta?.setAttribute( 'busy', '' );
			cta?.setAttribute( 'disabled', '' );
			if ( cta ) {
				cta.textContent = __( 'Activating…', 'desktop-mode' );
			}
			try {
				const updated = await activateInstalledPlugin( installed );
				state.installed.set( indexKeyFor( updated ), updated );
				toast(
					sprintf(
						/* translators: %s: plugin name */
						__( '%s activated.', 'desktop-mode' ),
						updated.name || updated.plugin,
					),
				);
				const plugin = state.plugins.find(
					( p ) => p.slug === ( updated.textdomain ?? '' ),
				);
				if ( plugin ) {
					repaintCardCta( card, plugin, state.installed, cardCallbacks );
				}
				broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
					source: SOURCE,
					plugin: updated.plugin,
					action: 'activate',
				} );
				void refreshFrameworkMenu();
			} catch ( err ) {
				cta?.removeAttribute( 'busy' );
				cta?.removeAttribute( 'disabled' );
				if ( cta ) {
					cta.textContent = originalText;
				}
				toast(
					sprintf(
						/* translators: %s: error message */
						__( 'Activation failed: %s', 'desktop-mode' ),
						formatError( err ),
					),
					6000,
				);
			}
		},
	};

	// ─── Initial loads ─────────────────────────────────────────────────
	void load();

	async function load(): Promise< void > {
		state.loading = true;
		paintSkeletons();
		try {
			// Run both fetches in parallel — the installed cache is what
			// flips the card CTA from "Install" to "Active", and we want
			// the first frame to land in its final state instead of a
			// brief "Install" flash for a plugin the user already has.
			const [ featured, installed ] = await Promise.all( [
				fetchFeaturedPlugins(),
				fetchInstalledPlugins().catch( () => [] as InstalledPlugin[] ),
			] );
			state.installed = new Map(
				installed.map( ( r ) => [ indexKeyFor( r ), r ] ),
			);
			state.plugins = featured.plugins ?? [];
			renderGallery();
			if ( state.plugins.length === 0 ) {
				showStatus( __( 'No featured plugins yet.', 'desktop-mode' ) );
			} else {
				hideStatus();
			}
		} catch ( err ) {
			gallery.replaceChildren();
			showStatus(
				sprintf(
					/* translators: %s: error message */
					__( 'Could not load featured plugins: %s', 'desktop-mode' ),
					formatError( err ),
				),
			);
		} finally {
			state.loading = false;
		}
	}

	function paintSkeletons(): void {
		gallery.replaceChildren();
		state.cardsBySlug.clear();
		for ( let i = 0; i < 3; i++ ) {
			gallery.appendChild( buildSkeletonCard() );
		}
	}

	function renderGallery(): void {
		gallery.replaceChildren();
		state.cardsBySlug.clear();
		for ( const plugin of state.plugins ) {
			if ( ! plugin?.slug ) {
				continue;
			}
			const card = buildCard( plugin, state.installed, cardCallbacks );
			if ( plugin.featured ) {
				// `<wpd-ribbon>` self-positions absolutely on its parent's
				// top-end corner (its host has `position: absolute`). The
				// `__card--featured` class below carries the matching
				// `position: relative` on the card host — these two lines
				// MUST stay paired. Removing the class while keeping the
				// `prepend` would re-anchor the ribbon to whatever
				// positioned ancestor the gallery happens to inherit
				// (usually the window body), so it would float over the
				// wrong thing entirely.
				card.classList.add( 'desktop-mode-plugins__card--featured' );
				const ribbon = document.createElement( 'wpd-ribbon' );
				ribbon.textContent = __( 'Featured', 'desktop-mode' );
				card.prepend( ribbon );
			}
			makeCardDraggable( card, plugin );
			gallery.appendChild( card );
			state.cardsBySlug.set( plugin.slug, card );
		}
	}

	function repaintSlugCard( slug: string ): void {
		if ( ! slug ) {
			return;
		}
		const card = state.cardsBySlug.get( slug );
		const plugin = state.plugins.find( ( p ) => p.slug === slug );
		if ( card && plugin ) {
			repaintCardCta( card, plugin, state.installed, cardCallbacks );
		}
	}

	async function refreshInstalled(): Promise< void > {
		try {
			const rows = await fetchInstalledPlugins();
			state.installed = new Map(
				rows.map( ( r ) => [ indexKeyFor( r ), r ] ),
			);
			for ( const [ slug, card ] of state.cardsBySlug ) {
				const plugin = state.plugins.find( ( p ) => p.slug === slug );
				if ( plugin ) {
					repaintCardCta( card, plugin, state.installed, cardCallbacks );
				}
			}
		} catch {
			// Best-effort.
		}
	}

	function showStatus( message: string ): void {
		status.hidden = false;
		status.textContent = message;
	}
	function hideStatus(): void {
		status.hidden = true;
		status.textContent = '';
	}

	// Cross-view sync — when Installed or Browse mutates a plugin we
	// might be showing, refresh the installed cache so the CTA flips.
	const unsubscribePluginsChanged = subscribe< PluginsChangedPayload >(
		PLUGINS_CHANGED_TOPIC,
		( payload ) => {
			if ( payload?.source === SOURCE ) {
				return;
			}
			void refreshInstalled();
		},
	);

	return () => {
		unsubscribePluginsChanged();
		host.replaceChildren();
	};
}

function buildSkeletonCard(): HTMLElement {
	const card = document.createElement( 'wpd-card' );
	card.classList.add(
		'desktop-mode-plugins__card',
		'desktop-mode-plugins__card--skeleton',
	);
	card.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 4; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'desktop-mode-plugins__skeleton-line';
		line.style.width = `${ 50 + ( i * 17 ) % 50 }%`;
		card.appendChild( line );
	}
	return card;
}

function indexKeyFor( plugin: InstalledPlugin ): string {
	return plugin.textdomain || plugin.plugin;
}

function formatError( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}
