import { __, html, sprintf } from '@openstation/app';
import { render } from '../../../src/ui/core';
import '../../../src/ui/components/os-stat/os-stat';
import type { Ctx } from '../../posts/parts/window-context';
import { buildEditPostUrl } from '../../posts/parts/cells/env';
import { loadAtlas, pageTitle, previewUrl, type AtlasData } from './atlas-model';
import { createAtlasScene, type AtlasScene } from './atlas-scene';
import { atlasStyles } from './atlas.styles';

export function mountPageAtlas( host: HTMLElement, ctx: Ctx ): () => void {
	let disposed = false;
	let controller = new AbortController();
	let scene: AtlasScene | null = null;
	let data: AtlasData = { pages: [], edges: [], total: 0 };
	let selected: number | null = null;
	let search = '';
	let kind = 'all';
	const browse = (): void => {
		root.classList.toggle( 'is-browsing' );
	};
	const select = ( id: number ): void => {
		selected = id;
		root.classList.remove( 'is-browsing' );
		paintDirectory();
		requestAnimationFrame( () => {
			if ( ! disposed ) {
				scene?.focus( id );
			}
		} );
	};
	const filter = (): void => {
		scene?.filter( kind, search ); paintDirectory();
	};
	render( html`<style>${ atlasStyles.cssText }</style><section class="os-page-atlas" aria-label=${ __( 'Page atlas' ) }>
		<header class="os-page-atlas__head"><div><h2>${ __( 'Your site, unfolded.' ) }</h2><p>${ __( 'Real pages. Real connections. A different perspective.' ) }</p></div>
			<div class="os-page-atlas__totals"><os-stat data-atlas-total value="—" label=${ __( 'Pages' ) }></os-stat><os-stat data-atlas-connections value="—" label=${ __( 'Connections' ) }></os-stat></div></header>
		<div class="os-page-atlas__tools">
			<os-text-field id=${ `${ ctx.windowId }-atlas-search` } aria-label=${ __( 'Find a page in the atlas' ) } placeholder=${ __( 'Find a page…' ) } @os-input-change=${ ( e: Event ) => {
 search = String( ( e as CustomEvent ).detail.value ); filter();
} }></os-text-field>
			<os-select aria-label=${ __( 'Connection type' ) } value="all" @os-pick=${ ( e: Event ) => {
 kind = String( ( e as CustomEvent ).detail.value ); filter();
} }>
				<os-option value="all">${ __( 'All connections' ) }</os-option><os-option value="parent">${ __( 'Page structure' ) }</os-option><os-option value="link">${ __( 'Content links' ) }</os-option>
			</os-select><os-button class="os-page-atlas__browse" variant="secondary" @click=${ browse }>${ __( 'Browse' ) }</os-button>
			<os-button class="os-page-atlas__refresh" variant="ghost" title=${ __( 'Refresh' ) } @click=${ () => void reload() }><span class="dashicons dashicons-update" aria-hidden="true"></span><span class="os-page-atlas__refresh-label">${ __( 'Refresh' ) }</span></os-button>
		</div>
		<div class="os-page-atlas__main">
			<div class="os-page-atlas__stage" aria-label=${ __( 'Page map. Drag to pan, scroll or pinch to zoom. Use arrow keys to pan and plus or minus to zoom. Browse the page directory to select a page.' ) }></div>
			<div class="os-page-atlas__zoom"><os-button variant="ghost" title=${ __( 'Zoom out' ) } @click=${ () => scene?.zoom( .8 ) }>−</os-button><output aria-label=${ __( 'Map zoom' ) }>100%</output><os-button variant="ghost" title=${ __( 'Zoom in' ) } @click=${ () => scene?.zoom( 1.25 ) }>+</os-button><os-button variant="secondary" @click=${ () => {
 selected = null; paintDirectory(); scene?.fit();
} }>${ __( 'Fit all' ) }</os-button></div>
			<aside class="os-page-atlas__directory" aria-label=${ __( 'Pages in the atlas' ) }><h3>${ __( 'Explore your pages' ) }</h3><div class="os-page-atlas__list"></div><div class="os-page-atlas__selection" aria-live="polite"></div></aside>
		</div>
		<footer class="os-page-atlas__legend"><span><i></i>${ __( 'Parent → child' ) }</span><span><i class="is-link"></i>${ __( 'Links to' ) }</span><small>${ __( '1440 × 900 previews · drag to explore' ) }</small></footer>
		<div class="os-page-atlas__message" role="status" hidden></div>
	</section>`, host );
	const root = host.querySelector< HTMLElement >( '.os-page-atlas' )!;
	const stage = root.querySelector< HTMLElement >( '.os-page-atlas__stage' )!;
	const list = root.querySelector< HTMLElement >( '.os-page-atlas__list' )!;
	const selection = root.querySelector< HTMLElement >( '.os-page-atlas__selection' )!;
	const message = root.querySelector< HTMLElement >( '.os-page-atlas__message' )!;
	const searchHost = root.querySelector( 'os-text-field' );
	queueMicrotask( () => searchHost?.shadowRoot?.querySelector( 'input' )?.setAttribute( 'aria-label', __( 'Find a page in the atlas' ) ) );
	const edges = () => data.edges.filter( ( edge ) => kind === 'all' || edge.kind === kind );
	const paintDirectory = (): void => {
		const query = search.toLocaleLowerCase().trim();
		const pages = data.pages.filter( ( p ) => `${ pageTitle( p ) } ${ p.slug }`.toLocaleLowerCase().includes( query ) );
		render( html`${ pages.length ? pages.map( ( p ) => html`<os-button variant="ghost" aria-pressed=${ String( selected === p.id ) } @click=${ () => select( p.id ) }>${ pageTitle( p ) }<span title=${ __( 'Connections' ) }>${ edges().filter( ( e ) => e.from === p.id || e.to === p.id ).length }</span></os-button>` ) : html`<p>${ __( 'No matching pages.' ) }</p>` }`, list );
		const page = data.pages.find( ( p ) => p.id === selected );
		const incoming = page ? data.edges.filter( ( e ) => e.to === page.id && e.kind === 'link' ).length : 0;
		const outgoing = page ? data.edges.filter( ( e ) => e.from === page.id && e.kind === 'link' ).length : 0;
		const url = page && previewUrl( page );
		render( page ? html`<strong>${ pageTitle( page ) }</strong><p>${ sprintf( __( '%1$d incoming · %2$d outgoing content links' ), incoming, outgoing ) }</p>
			<os-button variant="primary" @click=${ () => ctx.host.openUrl?.( buildEditPostUrl( ctx.extra, page.id ), pageTitle( page ), 'dashicons-admin-page' ) }>${ __( 'Open editor' ) } ↗</os-button>
			${ url ? html`<os-button variant="ghost" @click=${ () => ctx.host.openUrl?.( url, pageTitle( page ), 'dashicons-visibility' ) }>${ __( 'Open preview' ) } ↗</os-button>` : '' }
			<p>${ __( 'Connections come from page parents and links in page bodies. Menus are not included.' ) }</p>` : html`<strong>${ __( 'Follow a thread.' ) }</strong><p>${ __( 'Choose a page to bring it closer and trace its connections. Pages with no connections remain visible.' ) }</p>`, selection );
		queueMicrotask( () => list.querySelectorAll( 'os-button' ).forEach( ( button ) => button.shadowRoot?.querySelector( 'button' )?.setAttribute( 'aria-pressed', button.getAttribute( 'aria-pressed' ) || 'false' ) ) );
	};
	const reload = async (): Promise< void > => {
		controller.abort(); controller = new AbortController();
		const signal = controller.signal;
		scene?.dispose(); scene = null; selected = null;
		stage.textContent = '';
		message.hidden = false; message.textContent = __( 'Unfolding your pages…' );
		root.setAttribute( 'aria-busy', 'true' );
		try {
			const result = await loadAtlas( ctx.fetch, signal );
			if ( signal.aborted || disposed ) {
				return;
			}
			data = result;
			root.querySelector( '[data-atlas-total]' )?.setAttribute( 'value', String( data.pages.length ) );
			root.querySelector( '[data-atlas-connections]' )?.setAttribute( 'value', String( data.edges.length ) );
			paintDirectory();
			if ( ! data.pages.length ) {
				message.textContent = __( 'No pages yet. Create your first page to start the atlas.' ); return;
			}

			const surface = document.createElement( 'div' );
			surface.className = 'os-page-atlas__surface';
			surface.tabIndex = 0;
			surface.setAttribute( 'role', 'region' );
			surface.setAttribute( 'aria-label', stage.getAttribute( 'aria-label' ) || __( 'Page map' ) );
			stage.append( surface );
			const mounted = await createAtlasScene( surface, data, typeof ctx.extra.frontPageId === 'number' ? ctx.extra.frontPageId : undefined, select, ( zoom ) => {
				root.querySelector( 'output' )!.textContent = `${ Math.round( zoom * 100 ) }%`;
			}, signal );
			if ( disposed || signal.aborted ) {
				mounted?.dispose(); return;
			}
			scene = mounted; scene?.filter( kind, search );
			message.hidden = data.total <= data.pages.length;
			message.textContent = sprintf( __( 'Showing %1$d of %2$d pages. Connections outside this set are not shown.' ), data.pages.length, data.total );
		} catch ( error ) {
			if ( signal.aborted || disposed ) {
				return;
			}
			message.hidden = false; message.textContent = error instanceof Error ? error.message : __( 'The atlas could not load. Try Refresh.' );
		} finally {
			if ( ! signal.aborted && ! disposed ) {
				root.removeAttribute( 'aria-busy' );
			}
		}
	};
	void reload();
	return () => {
		disposed = true; controller.abort(); scene?.dispose(); host.replaceChildren();
	};
}
