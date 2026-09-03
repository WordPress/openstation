/**
 * Plugins app — the card galleries (Browse and Featured).
 *
 * Part of the `desktop-mode-plugins` client view. Both tabs paint a
 * grid of {@link buildCard}s into an `os-preserve` host and share
 * everything but their source: the Browse gallery pages through
 * `plugins_api( 'query_plugins' )` with an IntersectionObserver
 * sentinel (infinite scroll), the Featured gallery loads the curated
 * + discovered list once. Card CTAs read the installed state off the
 * app's live `data()` and repaint whenever it changes, so an install
 * or activation anywhere (the table, the flyout, the upload dialog,
 * the chromeless bridge) flips them without a fetch of their own.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { buildCard, buildSkeletonCard, repaintCardCta, type CardCallbacks, type InstalledIndex } from './card';
import { makeCardDraggable } from './card-drag';
import { openDetailFlyout } from './flyout-detail';
import { activatePlugin, installBySlug } from './mutations';
import {
	describeError,
	indexKeyFor,
	type BrowseFilter,
	type PluginsHost,
	type WpOrgBrowsePlugin,
} from './types';
import '../../../src/ui/components/os-card/os-card';
import '../../../src/ui/components/os-ribbon/os-ribbon';

const BROWSE_PAGE_SIZE = 24;

interface GalleryDeps {
	host: PluginsHost;
	flyout: () => HTMLElement | null;
}

/** What a mounted gallery keeps between paints. */
interface GalleryCore {
	plugins: WpOrgBrowsePlugin[];
	cardsBySlug: Map< string, HTMLElement >;
	callbacks: CardCallbacks;
	installedIndex: () => InstalledIndex;
	/** Repaint every card's CTA against the current installed list. */
	repaintCtas: () => void;
	addCard: ( gallery: HTMLElement, plugin: WpOrgBrowsePlugin, before: Node | null, featured: boolean ) => void;
	showStatus: ( status: HTMLElement, message: string ) => void;
	hideStatus: ( status: HTMLElement ) => void;
}

function createCore( deps: GalleryDeps ): GalleryCore {
	const { host } = deps;
	const cardsBySlug = new Map< string, HTMLElement >();
	const plugins: WpOrgBrowsePlugin[] = [];
	const installedIndex = (): InstalledIndex =>
		new Map( host.installed.map( ( r ) => [ indexKeyFor( r ), r ] ) );

	const setCtaBusy = ( card: HTMLElement, label: string ): ( () => void ) => {
		const cta = card.querySelector< HTMLElement >( '[data-plugin-card-cta]' );
		const original = cta?.textContent ?? '';
		cta?.setAttribute( 'busy', '' );
		cta?.setAttribute( 'disabled', '' );
		if ( cta ) {
			cta.textContent = label;
		}
		return () => {
			cta?.removeAttribute( 'busy' );
			cta?.removeAttribute( 'disabled' );
			if ( cta ) {
				cta.textContent = original;
			}
		};
	};

	const callbacks: CardCallbacks = {
		onOpen: ( slug, hint ) => {
			const el = deps.flyout();
			if ( el ) {
				openDetailFlyout( el, slug, hint, host );
			}
		},
		onInstall: async ( plugin, card ) => {
			const restore = setCtaBusy( card, __( 'Installing…', 'desktop-mode' ) );
			const ok = await installBySlug( host, plugin.slug, plugin.name );
			if ( ! ok ) {
				restore();
			}
			repaintCtas();
		},
		onActivate: async ( installed, card ) => {
			const restore = setCtaBusy( card, __( 'Activating…', 'desktop-mode' ) );
			const ok = await activatePlugin( host, installed );
			if ( ! ok ) {
				restore();
			}
			repaintCtas();
		},
	};

	const repaintCtas = (): void => {
		const index = installedIndex();
		for ( const [ slug, card ] of cardsBySlug ) {
			const plugin = plugins.find( ( p ) => p.slug === slug );
			if ( plugin ) {
				repaintCardCta( card, plugin, index, callbacks );
			}
		}
	};

	return {
		plugins,
		cardsBySlug,
		callbacks,
		installedIndex,
		repaintCtas,
		addCard: ( gallery, plugin, before, featured ) => {
			const card = buildCard( plugin, installedIndex(), callbacks );
			if ( featured ) {
				// `<os-ribbon>` anchors to the card host's `position:
				// relative` (`os-plugins__card--featured`) — keep paired.
				card.classList.add( 'os-plugins__card--featured' );
				const ribbon = document.createElement( 'os-ribbon' );
				ribbon.textContent = __( 'Featured', 'desktop-mode' );
				card.prepend( ribbon );
			}
			makeCardDraggable( card, plugin );
			gallery.insertBefore( card, before );
			cardsBySlug.set( plugin.slug, card );
			plugins.push( plugin );
		},
		showStatus: ( status, message ) => {
			status.hidden = false;
			status.textContent = message;
		},
		hideStatus: ( status ) => {
			status.hidden = true;
			status.textContent = '';
		},
	};
}

// ─── Browse ────────────────────────────────────────────────────────

export interface BrowseGallery {
	/** Re-wire after a paint; a changed filter / query starts over. */
	sync: ( opts: { gallery: HTMLElement | null; status: HTMLElement | null; filter: BrowseFilter; query: string } ) => void;
	/** Start over on the current filter / query (the Refresh button). */
	reset: () => void;
	repaintCtas: () => void;
	dispose: () => void;
}

export function createBrowseGallery( deps: GalleryDeps ): BrowseGallery {
	const core = createCore( deps );
	const sentinel = document.createElement( 'div' );
	sentinel.className = 'os-plugins__gallery-sentinel';
	sentinel.setAttribute( 'aria-hidden', 'true' );
	let gallery: HTMLElement | null = null;
	let status: HTMLElement | null = null;
	let observer: IntersectionObserver | null = null;
	let key = '';
	let filter: BrowseFilter = 'featured';
	let query = '';
	let page = 1;
	let totalPages = 0;
	let loading = false;
	let exhausted = false;
	const inflightSkeletons: HTMLElement[] = [];

	const resetAndLoad = async (): Promise< void > => {
		if ( ! gallery ) {
			return;
		}
		page = 1;
		totalPages = 0;
		exhausted = false;
		core.plugins.length = 0;
		core.cardsBySlug.clear();
		gallery.replaceChildren();
		for ( let i = 0; i < 6; i++ ) {
			gallery.appendChild( buildSkeletonCard() );
		}
		// The sentinel stays LAST so it scrolls with the content and
		// the observer (rooted on the gallery) keeps seeing it.
		gallery.appendChild( sentinel );
		await loadMore();
	};

	const loadMore = async (): Promise< void > => {
		if ( ! gallery || ! status || loading || exhausted ) {
			return;
		}
		loading = true;
		if ( page > 1 && inflightSkeletons.length === 0 ) {
			for ( let i = 0; i < 4; i++ ) {
				const skel = buildSkeletonCard();
				gallery.insertBefore( skel, sentinel );
				inflightSkeletons.push( skel );
			}
		}
		try {
			const data = await deps.host.rest.browsePlugins( {
				browse: query === '' ? filter : undefined,
				search: query === '' ? undefined : query,
				page,
				perPage: BROWSE_PAGE_SIZE,
			} );
			if ( page === 1 ) {
				gallery.replaceChildren();
				gallery.appendChild( sentinel );
			}
			// `info.pages` is wp.org's authoritative page count.
			const info = ( data.info ?? {} ) as { pages?: number };
			if ( typeof info.pages === 'number' && info.pages > 0 ) {
				totalPages = info.pages;
			}
			const incoming = data.plugins ?? [];
			if ( incoming.length === 0 ) {
				exhausted = true;
				if ( page === 1 ) {
					core.showStatus( status, __( 'No plugins matched.', 'desktop-mode' ) );
				}
				return;
			}
			for ( const plugin of incoming ) {
				if ( plugin?.slug && ! core.cardsBySlug.has( plugin.slug ) ) {
					core.addCard( gallery, plugin, sentinel, false );
				}
			}
			page++;
			// Two exhaustion signals — trust whichever fires first.
			if ( totalPages > 0 ? page > totalPages : incoming.length < BROWSE_PAGE_SIZE ) {
				exhausted = true;
			}
			core.hideStatus( status );
		} catch ( err ) {
			core.showStatus(
				status,
				sprintf(
					/* translators: %s: error message */
					__( 'Could not load plugins: %s', 'desktop-mode' ),
					describeError( err ),
				),
			);
		} finally {
			for ( const skel of inflightSkeletons ) {
				skel.remove();
			}
			inflightSkeletons.length = 0;
			loading = false;
		}
	};

	return {
		sync: ( opts ) => {
			status = opts.status;
			if ( opts.gallery !== gallery ) {
				gallery = opts.gallery;
				observer?.disconnect();
				observer = null;
				key = '';
				if ( gallery ) {
					// `root: gallery` so the observer fires against the
					// gallery's own scroll, not the document viewport.
					observer = new IntersectionObserver(
						( entries ) => {
							if ( entries.some( ( entry ) => entry.isIntersecting ) ) {
								void loadMore();
							}
						},
						{ root: gallery, rootMargin: '240px', threshold: 0 },
					);
					observer.observe( sentinel );
				}
			}
			const next = `${ opts.filter }|${ opts.query }`;
			if ( gallery && next !== key ) {
				key = next;
				filter = opts.filter;
				query = opts.query;
				void resetAndLoad();
			}
		},
		reset: () => void resetAndLoad(),
		repaintCtas: core.repaintCtas,
		dispose: () => {
			observer?.disconnect();
			observer = null;
		},
	};
}

// ─── Featured ──────────────────────────────────────────────────────

export interface FeaturedGallery {
	/** Re-wire after a paint; loads once on the first host it sees. */
	sync: ( opts: { gallery: HTMLElement | null; status: HTMLElement | null } ) => void;
	repaintCtas: () => void;
}

export function createFeaturedGallery( deps: GalleryDeps ): FeaturedGallery {
	const core = createCore( deps );
	let gallery: HTMLElement | null = null;

	const load = async ( status: HTMLElement | null ): Promise< void > => {
		if ( ! gallery ) {
			return;
		}
		gallery.replaceChildren();
		core.cardsBySlug.clear();
		core.plugins.length = 0;
		for ( let i = 0; i < 3; i++ ) {
			gallery.appendChild( buildSkeletonCard() );
		}
		try {
			const featured = await deps.host.rest.fetchFeaturedPlugins();
			gallery.replaceChildren();
			for ( const plugin of featured.plugins ?? [] ) {
				if ( plugin?.slug ) {
					core.addCard( gallery, plugin, null, !! plugin.featured );
				}
			}
			if ( status ) {
				if ( core.plugins.length === 0 ) {
					core.showStatus( status, __( 'No featured plugins yet.', 'desktop-mode' ) );
				} else {
					core.hideStatus( status );
				}
			}
		} catch ( err ) {
			gallery.replaceChildren();
			if ( status ) {
				core.showStatus(
					status,
					sprintf(
						/* translators: %s: error message */
						__( 'Could not load featured plugins: %s', 'desktop-mode' ),
						describeError( err ),
					),
				);
			}
		}
	};

	return {
		sync: ( opts ) => {
			if ( opts.gallery && opts.gallery !== gallery ) {
				gallery = opts.gallery;
				void load( opts.status );
			}
		},
		repaintCtas: core.repaintCtas,
	};
}
