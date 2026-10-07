import { readCanvasColor, readCanvasPalette, watchCanvasPalette } from '../../posts/parts/canvas/palette';
import { selectPreviews } from './atlas-previews';
import { __, html } from '@openstation/app';
import { routeThread, type RoutePoint } from './atlas-layout';
import { STATUS_LABELS } from '../../posts/parts/cells/env';
import { render } from '../../../src/ui/core';
import { createPixiApp, destroyPixiApp, loadPixi, type PixiGraphics } from '../../posts/parts/canvas/pixi';
import { type AtlasCamera, wireAtlasCamera, zoomAt } from './atlas-camera';
import { type AtlasData, pageTitle, previewUrl, arrangePages, SHEET_WIDTH, SHEET_HEIGHT, PREVIEW_WIDTH, PREVIEW_HEIGHT } from './atlas-model';

export interface AtlasScene {
	focus( id: number ): void;
	filter( kind: string, search: string ): void;
	fit(): void;
	zoom( factor: number ): void;
	dispose(): void;
}

export async function createAtlasScene( stage: HTMLElement, data: AtlasData, frontPageId: number | undefined, onSelect: ( id: number ) => void, onZoom: ( zoom: number ) => void, signal: AbortSignal ): Promise< AtlasScene | null > {
	const loader = document.createElement( 'div' );
	const pixi = await loadPixi( loader, __( 'The connection renderer is unavailable.' ) );
	if ( signal.aborted ) {
		return null;
	}
	if ( ! pixi ) {
		throw new Error( loader.textContent || __( 'PixiJS could not load.' ) );
	}
	const { app, world } = await createPixiApp( pixi, stage, 'os-page-atlas__canvas' );
	if ( signal.aborted ) {
		destroyPixiApp( app, stage, [] ); return null;
	}
	app.ticker?.stop();
	const lines = new pixi.Graphics(); world.addChild( lines );
	const overlay = document.createElement( 'div' ); overlay.className = 'os-page-atlas__world'; stage.append( overlay );
	const nodes = arrangePages( data.pages, frontPageId, data.edges );
	const byId = new Map( nodes.map( ( node ) => [ node.page.id, node ] ) );
	const cards = new Map< number, HTMLElement >();
	const frames = new Map< number, HTMLIFrameElement >();
	const camera: AtlasCamera = { x: 30, y: 30, zoom: .8 };
	let selected: number | null = null;
	let kind = 'all';
	let search = '';
	let disposed = false;
	let previewTimer = 0;
	let animation = 0;
	let accent = readCanvasPalette( stage ).accent;
	let linkColor = readCanvasColor( stage, '--os-ui-info-fg', '#72aee6', readCanvasPalette( stage ).surface );
	for ( const node of nodes ) {
		const card = document.createElement( 'article' ); card.className = 'os-page-atlas__sheet';
		card.dataset.pageId = String( node.page.id ); card.style.left = `${ node.x }px`; card.style.top = `${ node.y }px`;
		render( html`<header class="os-page-atlas__sheet-head"><span aria-hidden="true">${ node.page.id === frontPageId ? '⌂' : '▤' }</span><os-button variant="ghost" title=${ pageTitle( node.page ) } @click=${ () => onSelect( node.page.id ) }>${ pageTitle( node.page ) }</os-button></header>
			<div class="os-page-atlas__viewport"><div class="os-page-atlas__placeholder">${ __( 'Zoom closer for a live preview' ) }</div></div>
			<footer class="os-page-atlas__sheet-foot"><span>/${ node.page.slug }</span><span>${ STATUS_LABELS[ node.page.status ] || node.page.status }</span></footer>`, card );
		overlay.append( card ); cards.set( node.page.id, card );
	}
	const stroke = ( graph: PixiGraphics, points: RoutePoint[], color: number, width: number, alpha: number ): void => {
		graph.moveTo( points[ 0 ].x, points[ 0 ].y );
		for ( let i = 1; i < points.length - 1; i++ ) {
			const previous = points[ i - 1 ]; const point = points[ i ]; const next = points[ i + 1 ];
			const before = Math.hypot( point.x - previous.x, point.y - previous.y );
			const after = Math.hypot( next.x - point.x, next.y - point.y );
			const radius = Math.min( 14, before / 2, after / 2 );
			const a = { x: point.x + ( previous.x - point.x ) / before * radius, y: point.y + ( previous.y - point.y ) / before * radius };
			const b = { x: point.x + ( next.x - point.x ) / after * radius, y: point.y + ( next.y - point.y ) / after * radius };
			graph.lineTo( a.x, a.y ).bezierCurveTo( point.x, point.y, point.x, point.y, b.x, b.y );
		}
		const end = points[ points.length - 1 ]; graph.lineTo( end.x, end.y ).stroke( { color, width, alpha } );
	};
	const drawEdges = (): void => {
		lines.clear();
		const neighbors = new Set< number >();
		for ( const [ index, edge ] of data.edges.entries() ) {
			if ( kind !== 'all' && edge.kind !== kind ) {
				continue;
			}
			const from = byId.get( edge.from ); const to = byId.get( edge.to );
			if ( ! from || ! to ) {
				continue;
			}
			const active = selected === null || edge.from === selected || edge.to === selected;
			if ( active ) {
				neighbors.add( edge.from ); neighbors.add( edge.to );
			}
			const color = edge.kind === 'parent' ? accent : linkColor;
			const points = routeThread( from, to, index );
			stroke( lines, points, color, active ? 10 : 4, active ? .07 : .025 );
			stroke( lines, points, color, active ? 2 : 1, active ? .7 : .14 );
			const end = points[ points.length - 1 ]; const before = points[ points.length - 2 ];
			const direction = Math.sign( end.x - before.x ) || 1;
			lines.moveTo( end.x - direction * 9, end.y - 5 ).lineTo( end.x, end.y ).lineTo( end.x - direction * 9, end.y + 5 ).stroke( { color, width: 2, alpha: active ? .9 : .16 } );
			lines.circle( points[ 0 ].x, points[ 0 ].y, 3 ).fill( { color, alpha: active ? .9 : .16 } );
		}
		for ( const node of nodes ) {
			const card = cards.get( node.page.id )!;
			card.classList.toggle( 'is-selected', node.page.id === selected );
			card.classList.toggle( 'is-muted', search ? ! `${ pageTitle( node.page ) } ${ node.page.slug }`.toLocaleLowerCase().includes( search ) : selected !== null && node.page.id !== selected && ! neighbors.has( node.page.id ) );
		}
	};

	const updatePreviews = (): void => {
		if ( disposed ) {
			return;
		}
		const width = stage.clientWidth; const height = stage.clientHeight;
		const visible = width && height ? nodes.filter( ( n ) => camera.x + ( n.x + SHEET_WIDTH ) * camera.zoom > 0 && camera.y + ( n.y + SHEET_HEIGHT ) * camera.zoom > 0 && camera.x + n.x * camera.zoom < width && camera.y + n.y * camera.zoom < height ).sort( ( a, b ) => {
			if ( a.page.id === selected ) {
				return -1;
			}
			if ( b.page.id === selected ) {
				return 1;
			}
			return Math.hypot( camera.x + a.x * camera.zoom - width / 2, camera.y + a.y * camera.zoom - height / 2 ) - Math.hypot( camera.x + b.x * camera.zoom - width / 2, camera.y + b.y * camera.zoom - height / 2 );
		} ) : [];
		const wanted = new Set( selectPreviews( visible.filter( ( n ) => previewUrl( n.page ) ).map( ( n ) => n.page.id ), [ ...frames.keys() ], selected, camera.zoom ) );
		for ( const [ id, card ] of cards ) {
			const placeholder = card.querySelector< HTMLElement >( '.os-page-atlas__placeholder' )!;
			placeholder.textContent = camera.zoom < .5 ? __( 'Zoom closer for a live preview' ) : __( 'Select this page for a live preview' );
			if ( ! previewUrl( byId.get( id )!.page ) ) {
				placeholder.textContent = __( 'Open the editor to preview this page.' );
			}
		}
		for ( const [ id, frame ] of frames ) {
			if ( ! wanted.has( id ) ) {
				frame.remove(); frames.delete( id );
			}
		}
		for ( const node of visible ) {
			if ( ! wanted.has( node.page.id ) || frames.has( node.page.id ) ) {
				continue;
			}
			const viewport = cards.get( node.page.id )!.querySelector< HTMLElement >( '.os-page-atlas__viewport' )!;
			const url = previewUrl( node.page );
			if ( ! url ) {
				continue;
			}
			const frame = document.createElement( 'iframe' );
			frame.title = `${ __( 'Page preview' ) }: ${ pageTitle( node.page ) }`;
			frame.width = String( PREVIEW_WIDTH ); frame.height = String( PREVIEW_HEIGHT );
			frame.tabIndex = -1; frame.setAttribute( 'aria-hidden', 'true' ); frame.setAttribute( 'inert', '' );

			frame.setAttribute( 'sandbox', 'allow-scripts allow-same-origin' );
			frame.src = url; viewport.append( frame ); frames.set( node.page.id, frame );
		}
	};
	const draw = (): void => {
		if ( disposed ) {
			return;
		}
		world.x = camera.x; world.y = camera.y; world.scale.set( camera.zoom );
		overlay.style.transform = `translate(${ camera.x }px, ${ camera.y }px) scale(${ camera.zoom })`;
		app.render(); onZoom( camera.zoom );
		clearTimeout( previewTimer ); previewTimer = window.setTimeout( updatePreviews, 160 );
	};
	const fit = (): void => {
		if ( ! stage.clientWidth || ! stage.clientHeight ) {
			return;
		}
		const width = Math.max( SHEET_WIDTH, ...nodes.map( ( n ) => n.x + SHEET_WIDTH ) );
		const height = Math.max( SHEET_HEIGHT, ...nodes.map( ( n ) => n.y + SHEET_HEIGHT ) );
		camera.zoom = Math.max( .08, Math.min( 1, ( stage.clientWidth - 70 ) / width, ( stage.clientHeight - 70 ) / height ) );
		camera.x = ( stage.clientWidth - width * camera.zoom ) / 2; camera.y = ( stage.clientHeight - height * camera.zoom ) / 2; draw();
	};
	const focus = ( id: number ): void => {
		const node = byId.get( id ); if ( ! node ) {
			return;
		}
		selected = id; drawEdges();
		const start = { ...camera };
		const zoom = Math.min( 1.1, ( stage.clientWidth - 80 ) / SHEET_WIDTH, ( stage.clientHeight - 80 ) / SHEET_HEIGHT );
		const target = { zoom: Math.max( .35, zoom ), x: stage.clientWidth / 2 - ( node.x + SHEET_WIDTH / 2 ) * zoom, y: stage.clientHeight / 2 - ( node.y + SHEET_HEIGHT / 2 ) * zoom };
		cancelAnimationFrame( animation );
		const reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		const begin = performance.now();
		const step = ( now: number ): void => {
			if ( disposed ) {
				return;
			}
			const t = reduced ? 1 : Math.min( 1, ( now - begin ) / 330 ); const ease = 1 - Math.pow( 1 - t, 3 );
			camera.x = start.x + ( target.x - start.x ) * ease; camera.y = start.y + ( target.y - start.y ) * ease; camera.zoom = start.zoom + ( target.zoom - start.zoom ) * ease;
			draw(); if ( t < 1 ) {
				animation = requestAnimationFrame( step );
			}
		};
		animation = requestAnimationFrame( step );
	};
	const untheme = watchCanvasPalette( stage, () => {
		accent = readCanvasPalette( stage ).accent;
		linkColor = readCanvasColor( stage, '--os-ui-info-fg', '#72aee6', readCanvasPalette( stage ).surface );
		drawEdges(); app.render();
	}, () => readCanvasColor( stage, '--os-ui-info-fg', '#72aee6', readCanvasPalette( stage ).surface ) );
	const unwire = wireAtlasCamera( stage, camera, draw );
	let hadSize = false;
	const resize = new ResizeObserver( () => {
		if ( disposed ) {
			return;
		}
		if ( stage.clientWidth && stage.clientHeight ) {
			app.renderer.resize( stage.clientWidth, stage.clientHeight );
			if ( ! hadSize ) {
				fit(); hadSize = true;
			} else {
				draw();
			}
		} else {
			updatePreviews();
		}
	} ); resize.observe( stage );
	drawEdges(); fit();
	return { focus, fit: () => {
		cancelAnimationFrame( animation ); selected = null; drawEdges(); fit();
	}, filter: ( next, query ) => {
		kind = next; search = query.toLocaleLowerCase().trim(); drawEdges(); draw();
	}, zoom: ( factor ) => {
		cancelAnimationFrame( animation ); zoomAt( camera, camera.zoom * factor, stage.clientWidth / 2, stage.clientHeight / 2 ); draw();
	}, dispose: () => {
		disposed = true; untheme(); clearTimeout( previewTimer ); cancelAnimationFrame( animation ); unwire(); resize.disconnect(); frames.forEach( ( frame ) => frame.remove() ); destroyPixiApp( app, stage, [] );
	} };
}
