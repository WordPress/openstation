/**
 * Native Plugins window — Browse tab.
 *
 * Search field + segmented browse filter + Upload button + a
 * `<os-grid>`-style gallery of cards. Infinite scroll via
 * IntersectionObserver on a sentinel.
 *
 * The whole window body also acts as a drop zone for `.zip` files —
 * dragging from Finder/Explorer onto the window opens the upload
 * dialog with the file pre-applied.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import { broadcast, subscribe } from '../broadcast';
import {
	buildCard,
	repaintCardCta,
	type CardCallbacks,
	type InstalledIndex,
} from './card';

/**
 * Cross-view sync topic for the Plugins window. See
 * `installed-view.ts` for the contract.
 *
 * @internal
 */
const PLUGINS_CHANGED_TOPIC = 'os.plugin.changed';
const SOURCE = 'browse-view';
interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'bulk';
}
import { installPluginDropTargets, makeCardDraggable } from './card-drag';
import { openDetailFlyout } from './flyout-detail';
import {
	activateInstalledPlugin,
	browsePlugins,
	fetchInstalledPlugins,
	getConfig,
	installPluginBySlug,
	refreshFrameworkMenu,
} from './rest';
import type {
	BrowseFilter,
	InstalledPlugin,
	WpOrgBrowsePlugin,
} from './types';
import { openUploadDialog } from './upload-dialog';
import '../ui/components/os-button/os-button';
import '../ui/components/os-card/os-card';
import '../ui/components/os-segmented/os-segmented';
import '../ui/components/os-text-field/os-text-field';

interface BrowseState {
	filter: BrowseFilter;
	search: string;
	page: number;
	totalPages: number;
	loading: boolean;
	exhausted: boolean;
	plugins: WpOrgBrowsePlugin[];
	installed: InstalledIndex;
	cardsBySlug: Map< string, HTMLElement >;
}

/** Toast helper — mirrors installed-view.ts. */
function toast( message: string, duration = 3500 ): void {
	const api = window.wp?.os;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( { message, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.log( '[plugins-window]', message );
}

/**
 * Mount the Browse view into a host element. Returns a teardown.
 *
 * `flyoutEl` is the `<os-flyout data-os-plugins-flyout>`
 * declared in the template — we share it across cards.
 */
export function mountBrowseView(
	host: HTMLElement,
	flyoutEl: HTMLElement | null,
	bodyEl: HTMLElement,
): () => void {
	host.replaceChildren();

	const state: BrowseState = {
		filter: 'featured',
		search: '',
		page: 1,
		totalPages: 0,
		loading: false,
		exhausted: false,
		plugins: [],
		installed: new Map(),
		cardsBySlug: new Map(),
	};

	// ─── Toolbar ────────────────────────────────────────────────────
	const toolbar = document.createElement( 'header' );
	toolbar.className = 'os-plugins__toolbar';

	const left = document.createElement( 'div' );
	left.className = 'os-plugins__toolbar-left';

	const segmented = document.createElement( 'os-segmented' );
	segmented.setAttribute( 'value', 'featured' );
	const filters: Array< { value: BrowseFilter; label: string } > = [
		{ value: 'featured', label: __( 'Featured', 'desktop-mode' ) },
		{ value: 'popular', label: __( 'Popular', 'desktop-mode' ) },
		{ value: 'recommended', label: __( 'Recommended', 'desktop-mode' ) },
		{ value: 'favorites', label: __( 'Favorites', 'desktop-mode' ) },
		{ value: 'new', label: __( 'New', 'desktop-mode' ) },
		{ value: 'beta', label: __( 'Beta', 'desktop-mode' ) },
	];
	for ( const opt of filters ) {
		const seg = document.createElement( 'os-segment' );
		seg.setAttribute( 'value', opt.value );
		seg.textContent = opt.label;
		segmented.appendChild( seg );
	}
	segmented.addEventListener( 'os-pick', ( ev: Event ) => {
		const next = ( ev as CustomEvent< { value: string } > ).detail?.value ?? 'featured';
		state.filter = next as BrowseFilter;
		void resetAndLoad();
	} );

	const search = document.createElement( 'os-text-field' );
	search.setAttribute( 'placeholder', __( 'Search WordPress.org…', 'desktop-mode' ) );
	let searchDebounce: number | undefined;
	search.addEventListener( 'os-input-change', ( ev: Event ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail?.value ?? '';
		window.clearTimeout( searchDebounce );
		searchDebounce = window.setTimeout( () => {
			state.search = value;
			void resetAndLoad();
		}, 250 );
	} );

	left.append( segmented, search );

	const right = document.createElement( 'div' );
	right.className = 'os-plugins__toolbar-trailing';
	const cfg = getConfig();
	if ( cfg.caps.upload ) {
		const upload = document.createElement( 'os-button' );
		upload.setAttribute( 'variant', 'secondary' );
		upload.innerHTML =
			'<span class="dashicons dashicons-upload" aria-hidden="true"></span> ' +
			__( 'Upload Plugin', 'desktop-mode' );
		upload.addEventListener( 'click', () => {
			void openUploadDialog( bodyEl, null, {
				onUploaded: () => void refreshInstalled(),
			} );
		} );
		right.appendChild( upload );
	}

	// Refresh button — re-fetch the current filter / search result
	// set from wp.org and the installed-state cache. Matches the
	// affordance on the Installed tab so the surface is symmetric;
	// also useful when wp.org's cached response lags the user's
	// just-uploaded plugin.
	const refreshButton = document.createElement( 'os-button' );
	refreshButton.setAttribute( 'variant', 'ghost' );
	refreshButton.setAttribute( 'title', __( 'Refresh', 'desktop-mode' ) );
	refreshButton.innerHTML =
		'<span class="dashicons dashicons-update" aria-hidden="true"></span>';
	refreshButton.addEventListener( 'click', () => {
		void refreshInstalled();
		void resetAndLoad();
	} );
	right.appendChild( refreshButton );

	toolbar.append( left, right );

	// ─── Gallery ────────────────────────────────────────────────────
	const gallery = document.createElement( 'div' );
	gallery.className = 'os-plugins__gallery';

	// The sentinel must live INSIDE the gallery scroll container —
	// IntersectionObserver with `root: gallery` only fires when the
	// observed element enters that scroll viewport. Earlier we
	// appended it as a sibling AFTER the gallery, which meant the
	// observer fired exactly once on initial mount (the sentinel was
	// in the document viewport) and never again on subsequent
	// scrolls. The sentinel now scrolls down WITH the gallery
	// content; as the user reaches the bottom, it slides into the
	// observer's `root` viewport and triggers the next fetch.
	const sentinel = document.createElement( 'div' );
	sentinel.className = 'os-plugins__gallery-sentinel';
	sentinel.setAttribute( 'aria-hidden', 'true' );

	const status = document.createElement( 'p' );
	status.className = 'os-plugins__gallery-status';
	status.hidden = true;

	host.append( toolbar, gallery, status );

	// ─── Window-level .zip drop overlay ────────────────────────────
	const dropOverlay = document.createElement( 'div' );
	dropOverlay.className = 'os-plugins__window-drop';
	dropOverlay.setAttribute( 'aria-hidden', 'true' );
	const dropMsg = document.createElement( 'p' );
	dropMsg.textContent = __(
		'Drop the .zip to install.',
		'desktop-mode',
	);
	dropOverlay.appendChild( dropMsg );
	bodyEl.appendChild( dropOverlay );

	let dragDepth = 0;
	const isZipDrag = ( ev: DragEvent ): boolean =>
		Boolean(
			ev.dataTransfer?.types.includes( 'Files' ),
		);

	const onDragEnter = ( ev: DragEvent ): void => {
		if ( ! cfg.caps.upload ) {
			return;
		}
		if ( ! isZipDrag( ev ) ) {
			return;
		}
		dragDepth++;
		bodyEl.classList.add( 'has-zip-dragover' );
	};
	const onDragLeave = ( ev: DragEvent ): void => {
		if ( ! cfg.caps.upload || ! isZipDrag( ev ) ) {
			return;
		}
		dragDepth = Math.max( 0, dragDepth - 1 );
		if ( dragDepth === 0 ) {
			bodyEl.classList.remove( 'has-zip-dragover' );
		}
	};
	const onDragOver = ( ev: DragEvent ): void => {
		if ( cfg.caps.upload && isZipDrag( ev ) ) {
			ev.preventDefault();
		}
	};
	const onDrop = ( ev: DragEvent ): void => {
		if ( ! cfg.caps.upload ) {
			return;
		}
		const file = ev.dataTransfer?.files?.[ 0 ];
		dragDepth = 0;
		bodyEl.classList.remove( 'has-zip-dragover' );
		if ( ! file ) {
			return;
		}
		ev.preventDefault();
		void openUploadDialog( bodyEl, file, {
			onUploaded: () => void refreshInstalled(),
		} );
	};
	bodyEl.addEventListener( 'dragenter', onDragEnter );
	bodyEl.addEventListener( 'dragleave', onDragLeave );
	bodyEl.addEventListener( 'dragover', onDragOver );
	bodyEl.addEventListener( 'drop', onDrop );

	// ─── Card drop targets (drag a card to dock to pin) ────────────
	const teardownDropTargets = installPluginDropTargets();

	// ─── Card callbacks ────────────────────────────────────────────
	const cardCallbacks: CardCallbacks = {
		onOpen: ( slug, hint ) => {
			if ( ! flyoutEl ) {
				return;
			}
			openDetailFlyout( flyoutEl, slug, hint, {
				getInstalled: ( s ) => state.installed.get( s ),
				onPluginInstalled: async ( pluginFile, slug2 ) => {
					await refreshInstalled();
					const card = state.cardsBySlug.get( slug2 );
					const plugin = state.plugins.find( ( p ) => p.slug === slug2 );
					if ( card && plugin ) {
						repaintCardCta( card, plugin, state.installed, cardCallbacks );
					}
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: pluginFile ?? slug2,
						action: 'install',
					} );
					if ( pluginFile ) {
						// eslint-disable-next-line no-console
						console.log( '[plugins-window] installed', pluginFile );
					}
				},
				onPluginActivated: ( updated ) => {
					state.installed.set( indexKeyFor( updated ), updated );
					const card = state.cardsBySlug.get( updated.textdomain ?? '' );
					const plugin = state.plugins.find(
						( p ) => p.slug === ( updated.textdomain ?? '' ),
					);
					if ( card && plugin ) {
						repaintCardCta( card, plugin, state.installed, cardCallbacks );
					}
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: updated.plugin,
						action: 'activate',
					} );
				},
				onPluginDeactivated: ( updated ) => {
					state.installed.set( indexKeyFor( updated ), updated );
					const card = state.cardsBySlug.get( updated.textdomain ?? '' );
					const plugin = state.plugins.find(
						( p ) => p.slug === ( updated.textdomain ?? '' ),
					);
					if ( card && plugin ) {
						repaintCardCta( card, plugin, state.installed, cardCallbacks );
					}
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: SOURCE,
						plugin: updated.plugin,
						action: 'deactivate',
					} );
				},
				onPluginDeleted: ( deleted ) => {
					const key = indexKeyFor( deleted );
					state.installed.delete( key );
					const card = state.cardsBySlug.get( deleted.textdomain ?? '' );
					const plugin = state.plugins.find(
						( p ) => p.slug === ( deleted.textdomain ?? '' ),
					);
					if ( card && plugin ) {
						repaintCardCta( card, plugin, state.installed, cardCallbacks );
					}
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
			const ctaOriginalText = cta?.textContent ?? '';
			cta?.setAttribute( 'busy', '' );
			cta?.setAttribute( 'disabled', '' );
			if ( cta ) {
				cta.textContent = __( 'Installing…', 'desktop-mode' );
			}
			try {
				await installPluginBySlug( plugin.slug );
				// Refresh the installed list first — this REST GET is
				// what flips the CTA from "Install" to "Activate". The
				// hidden-iframe menu refresh that follows is for the
				// dock/taskbar repaint and takes a full admin page
				// load; running it sequentially before the CTA repaint
				// was the source of the "Activate button takes time to
				// display" delay. Fire-and-forget the menu refresh so
				// the user sees the new CTA the instant the REST list
				// returns.
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
					cta.textContent = ctaOriginalText;
				}
				toast(
					sprintf(
						/* translators: %s: error message */
						__( 'Install failed: %s', 'desktop-mode' ),
						describe( err ),
					),
					6000,
				);
			}
		},
		onActivate: async ( installed, card ) => {
			const cta = card.querySelector< HTMLElement >( '[data-plugin-card-cta]' );
			const ctaOriginalText = cta?.textContent ?? '';
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
				// Background — dock/taskbar repaint shouldn't gate the
				// in-card "Active" state flip.
				void refreshFrameworkMenu();
			} catch ( err ) {
				cta?.removeAttribute( 'busy' );
				cta?.removeAttribute( 'disabled' );
				if ( cta ) {
					cta.textContent = ctaOriginalText;
				}
				toast(
					sprintf(
						/* translators: %s: error message */
						__( 'Activation failed: %s', 'desktop-mode' ),
						describe( err ),
					),
					6000,
				);
			}
		},
	};

	// ─── Infinite scroll ────────────────────────────────────────────
	// `root: gallery` so the observer fires against the gallery's
	// internal scroll, not the document viewport.
	const observer = new IntersectionObserver(
		( entries ) => {
			for ( const entry of entries ) {
				if ( entry.isIntersecting ) {
					void loadMore();
				}
			}
		},
		{ root: gallery, rootMargin: '240px', threshold: 0 },
	);
	observer.observe( sentinel );

	// ─── Initial loads ──────────────────────────────────────────────
	void refreshInstalled();
	void resetAndLoad();

	async function refreshInstalled(): Promise< void > {
		try {
			const rows = await fetchInstalledPlugins();
			state.installed = new Map(
				rows.map( ( r ) => [ indexKeyFor( r ), r ] ),
			);
			// Repaint every existing card so its CTA reflects the new
			// installed state.
			for ( const [ slug, card ] of state.cardsBySlug ) {
				const plugin = state.plugins.find( ( p ) => p.slug === slug );
				if ( plugin ) {
					repaintCardCta( card, plugin, state.installed, cardCallbacks );
				}
			}
		} catch {
			// Best-effort — a missing installed cache just means cards
			// show "Install" instead of "Active". Recovers on next call.
		}
	}

	async function resetAndLoad(): Promise< void > {
		state.page = 1;
		state.totalPages = 0;
		state.exhausted = false;
		state.plugins = [];
		state.cardsBySlug.clear();
		gallery.replaceChildren();
		// Skeleton cards while we wait for the first response.
		for ( let i = 0; i < 6; i++ ) {
			gallery.appendChild( buildSkeletonCard() );
		}
		// Sentinel must be the LAST child of the gallery so it scrolls
		// with the content. `replaceChildren()` removed it, so re-append.
		gallery.appendChild( sentinel );
		await loadMore();
	}

	/**
	 * Skeleton cards inserted just before the sentinel while a
	 *  loadMore() is in flight. Lets the user see "more is coming"
	 *  instead of the page going silent during the fetch. Cleared
	 *  on every loadMore exit.
	 */
	const inflightSkeletons: HTMLElement[] = [];

	function showInflightLoader(): void {
		if ( inflightSkeletons.length > 0 ) {
			return;
		}
		// Match the column count visually — pagination on a wide
		// gallery feels less abrupt with a few placeholders than one.
		for ( let i = 0; i < 4; i++ ) {
			const skel = buildSkeletonCard();
			gallery.insertBefore( skel, sentinel );
			inflightSkeletons.push( skel );
		}
	}

	function clearInflightLoader(): void {
		for ( const skel of inflightSkeletons ) {
			skel.remove();
		}
		inflightSkeletons.length = 0;
	}

	async function loadMore(): Promise< void > {
		if ( state.loading || state.exhausted ) {
			return;
		}
		state.loading = true;
		// Skeleton placeholders ONLY for subsequent pages — the
		// initial load already paints six skeletons via resetAndLoad,
		// and we'd double-up if we added more here.
		if ( state.page > 1 ) {
			showInflightLoader();
		}
		try {
			const data = await browsePlugins( {
				browse: state.search === '' ? state.filter : undefined,
				search: state.search === '' ? undefined : state.search,
				page: state.page,
				perPage: 24,
			} );
			if ( state.page === 1 ) {
				// Drop skeletons + any prior content; re-anchor the
				// sentinel as the last child for the observer.
				gallery.replaceChildren();
				gallery.appendChild( sentinel );
			}
			// `info.pages` is wp.org's authoritative page-count signal —
			// short-page heuristics get fooled when the API returns
			// fewer than `per_page` rows on a non-final page.
			const info = ( data.info ?? {} ) as { pages?: number; results?: number };
			if ( typeof info.pages === 'number' && info.pages > 0 ) {
				state.totalPages = info.pages;
			}
			const incoming = data.plugins ?? [];
			if ( incoming.length === 0 ) {
				state.exhausted = true;
				if ( state.page === 1 ) {
					showStatus( __( 'No plugins matched.', 'desktop-mode' ) );
				}
				return;
			}
			for ( const plugin of incoming ) {
				if ( ! plugin?.slug ) {
					continue;
				}
				if ( state.cardsBySlug.has( plugin.slug ) ) {
					continue;
				}
				const card = buildCard( plugin, state.installed, cardCallbacks );
				makeCardDraggable( card, plugin );
				// Always insert BEFORE the sentinel so it stays last
				// for IntersectionObserver to keep observing it.
				gallery.insertBefore( card, sentinel );
				state.cardsBySlug.set( plugin.slug, card );
				state.plugins.push( plugin );
			}
			state.page++;
			// Two exhaustion signals — trust whichever fires first.
			if ( state.totalPages > 0 && state.page > state.totalPages ) {
				state.exhausted = true;
			} else if ( state.totalPages === 0 && incoming.length < 24 ) {
				// Fallback when wp.org didn't surface a `pages` count.
				state.exhausted = true;
			}
			hideStatus();
		} catch ( err ) {
			showStatus(
				sprintf(
					/* translators: %s: error message */
					__( 'Could not load plugins: %s', 'desktop-mode' ),
					describe( err ),
				),
			);
		} finally {
			clearInflightLoader();
			state.loading = false;
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

	// Cross-view sync: when the Installed tab activates / deactivates
	// / deletes a plugin, refresh our installed-state cache so card
	// CTAs flip without the user having to switch tabs and back.
	// Self-emitted broadcasts are skipped — our own card callbacks
	// already updated the local map and repainted the affected card.
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
		observer.disconnect();
		bodyEl.removeEventListener( 'dragenter', onDragEnter );
		bodyEl.removeEventListener( 'dragleave', onDragLeave );
		bodyEl.removeEventListener( 'dragover', onDragOver );
		bodyEl.removeEventListener( 'drop', onDrop );
		dropOverlay.remove();
		teardownDropTargets();
		host.replaceChildren();
	};
}

function buildSkeletonCard(): HTMLElement {
	// Non-interactive `<os-card>` — same chrome as a real gallery
	// card without the hover lift, so the loading state visually
	// pre-frames the content that's about to land.
	const card = document.createElement( 'os-card' );
	card.classList.add(
		'os-plugins__card',
		'os-plugins__card--skeleton',
	);
	card.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 4; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'os-plugins__skeleton-line';
		line.style.width = `${ 50 + ( i * 17 ) % 50 }%`;
		card.appendChild( line );
	}
	return card;
}

function indexKeyFor( plugin: InstalledPlugin ): string {
	// Prefer the textdomain (matches wp.org slug) so the cross-lookup
	// from a Browse card works. Fall back to the plugin file path on
	// installs without a Text Domain header.
	return plugin.textdomain || plugin.plugin;
}

function describe( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}
