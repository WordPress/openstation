import { __, sprintf } from '@openstation/app';

import '../../../src/ui/components/os-ribbon/os-ribbon';
import { setBusy } from './actions';
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

const BROWSE_PAGE_SIZE = 24;

interface GalleryDeps {
	host: PluginsHost;
	flyout: () => HTMLElement | null;
}

interface GalleryCore {

	plugins: Map< string, { plugin: WpOrgBrowsePlugin; card: HTMLElement } >;
	callbacks: CardCallbacks;
	installedIndex: () => InstalledIndex;

	repaintCtas: () => void;
	addCard: ( gallery: HTMLElement, plugin: WpOrgBrowsePlugin, before: Node | null, featured: boolean ) => void;
	clear: () => void;
	showStatus: ( status: HTMLElement, message: string ) => void;
	hideStatus: ( status: HTMLElement ) => void;
}

function createCore( deps: GalleryDeps ): GalleryCore {
	const { host } = deps;
	const plugins = new Map< string, { plugin: WpOrgBrowsePlugin; card: HTMLElement } >();
	const installedIndex = (): InstalledIndex =>
		new Map( host.installed.map( ( r ) => [ indexKeyFor( r ), r ] ) );

	const cta = ( card: HTMLElement ): HTMLElement | null => card.querySelector< HTMLElement >( '[data-plugin-card-cta]' );

	const callbacks: CardCallbacks = {
		onOpen: ( slug, hint ) => {
			const el = deps.flyout();
			if ( el ) {
				openDetailFlyout( el, slug, hint, host );
			}
		},
		onInstall: async ( plugin, card ) => {
			const restore = setBusy( cta( card ), __( 'Installing…', 'desktop-mode' ) );
			const ok = await installBySlug( host, plugin.slug, plugin.name );
			if ( ! ok ) {
				restore();
			}
			repaintCtas();
		},
		onActivate: async ( installed, card ) => {
			const restore = setBusy( cta( card ), __( 'Activating…', 'desktop-mode' ) );
			const ok = await activatePlugin( host, installed );
			if ( ! ok ) {
				restore();
			}
			repaintCtas();
		},
	};

	const repaintCtas = (): void => {
		const index = installedIndex();
		for ( const { plugin, card } of plugins.values() ) {
			repaintCardCta( card, plugin, index, callbacks );
		}
	};

	return {
		plugins,
		callbacks,
		installedIndex,
		repaintCtas,
		addCard: ( gallery, plugin, before, featured ) => {
			const card = buildCard( plugin, installedIndex(), callbacks );
			if ( featured ) {
				card.classList.add( 'os-plugins__card--featured' );
				const ribbon = document.createElement( 'os-ribbon' );
				ribbon.textContent = __( 'Featured', 'desktop-mode' );
				card.prepend( ribbon );
			}
			makeCardDraggable( card, plugin );
			gallery.insertBefore( card, before );
			plugins.set( plugin.slug, { plugin, card } );
		},
		clear: () => plugins.clear(),
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

export interface BrowseGallery {

	sync: ( opts: {
		gallery: HTMLElement | null;
		status: HTMLElement | null;
		filter: BrowseFilter;
		query: string;
		active: boolean;
	} ) => void;

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
		core.clear();
		gallery.replaceChildren();
		for ( let i = 0; i < 6; i++ ) {
			gallery.appendChild( buildSkeletonCard() );
		}

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
				if ( plugin?.slug && ! core.plugins.has( plugin.slug ) ) {
					core.addCard( gallery, plugin, sentinel, false );
				}
			}
			page++;

			if ( totalPages > 0 ? page > totalPages : incoming.length < BROWSE_PAGE_SIZE ) {
				exhausted = true;
			}
			core.hideStatus( status );
		} catch ( err ) {
			core.showStatus(
				status,
				sprintf(

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

			if ( gallery && opts.active && next !== key ) {
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

export interface FeaturedGallery {

	sync: ( opts: { gallery: HTMLElement | null; status: HTMLElement | null; active: boolean } ) => void;
	repaintCtas: () => void;
}

export function createFeaturedGallery( deps: GalleryDeps ): FeaturedGallery {
	const core = createCore( deps );
	let gallery: HTMLElement | null = null;
	let loaded = false;

	const load = async ( status: HTMLElement | null ): Promise< void > => {
		if ( ! gallery ) {
			return;
		}
		loaded = true;
		gallery.replaceChildren();
		core.clear();
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
				if ( core.plugins.size === 0 ) {
					core.showStatus( status, __( 'No featured plugins yet.', 'desktop-mode' ) );
				} else {
					core.hideStatus( status );
				}
			}
		} catch ( err ) {
			gallery.replaceChildren();
			loaded = false;
			if ( status ) {
				core.showStatus(
					status,
					sprintf(

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
				loaded = false;
			}
			if ( gallery && opts.active && ! loaded ) {
				void load( opts.status );
			}
		},
		repaintCtas: core.repaintCtas,
	};
}
