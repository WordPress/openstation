import { __ } from '../../i18n';
import { registerWindowLinkRenderer } from '../renderer-registry';
import {
	anchorOnBorder,
	centerOf,
	closestBorderAnchors,
	controlPoint,
	isPointVisible,
	visibleBorderAnchor,
	type LinkAnchor,
	type LinkObstacle,
	type LinkRect,
} from '../geometry';
import type { WindowLinkFrame } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

let _mountSeq = 0;

interface EdgeElements {
	group: SVGGElement;
	path: SVGPathElement;
}

function endpointAnchor(
	rect: LinkRect,
	zIndex: number | null,
	windowId: string,
	obstacles: LinkObstacle[],
	toward: { x: number; y: number },
): LinkAnchor {
	const classic = anchorOnBorder( rect, toward );
	if (
		zIndex === null ||
		isPointVisible( classic, zIndex, obstacles, windowId )
	) {
		return classic;
	}
	return (
		visibleBorderAnchor( rect, zIndex, obstacles, windowId, toward ) ??
		classic
	);
}

interface EndpointMarkers {

	dot: { normal: string; active: string };

	port: { normal: string; active: string };
}

function buildMarkers(
	svg: SVGSVGElement,
	idBase: string,
): EndpointMarkers {
	const defs = document.createElementNS( SVG_NS, 'defs' );
	const make = (
		suffix: string,
		className: string,
		size: string,
	): string => {
		const id = `${ idBase }-${ suffix }`;
		const marker = document.createElementNS( SVG_NS, 'marker' );
		marker.setAttribute( 'id', id );
		marker.setAttribute( 'viewBox', '0 0 10 10' );
		marker.setAttribute( 'refX', '5' );
		marker.setAttribute( 'refY', '5' );
		marker.setAttribute( 'markerWidth', size );
		marker.setAttribute( 'markerHeight', size );
		marker.setAttribute( 'markerUnits', 'strokeWidth' );
		const tip = document.createElementNS( SVG_NS, 'circle' );
		tip.setAttribute( 'cx', '5' );
		tip.setAttribute( 'cy', '5' );
		tip.setAttribute( 'r', '4' );
		tip.classList.add( className );
		marker.appendChild( tip );
		defs.appendChild( marker );
		return id;
	};
	const endpoint = 'os-window-link__endpoint';
	const active = `${ endpoint }--active`;
	const markers: EndpointMarkers = {
		dot: {
			normal: make( 'dot', endpoint, '7' ),
			active: make( 'dot-active', active, '7' ),
		},
		port: {
			normal: make( 'port', endpoint, '4.5' ),
			active: make( 'port-active', active, '4.5' ),
		},
	};
	svg.appendChild( defs );
	return markers;
}

registerWindowLinkRenderer( {
	id: 'svg-splines',
	label: __( 'Splines' ),
	description: __(
		'Curved connectors between related windows, ending in circular dots — the larger dot sits on the window the content belongs to; windows that reference each other get large dots on both ends.',
	),
	mount: ( ctx ) => {
		const seq = ++_mountSeq;
		const buildSurface = (
			container: HTMLElement,
			suffix: string,
		): { svg: SVGSVGElement; markers: EndpointMarkers } => {
			const svg = document.createElementNS( SVG_NS, 'svg' );
			svg.classList.add( 'os-window-links__svg' );
			container.appendChild( svg );
			return {
				svg,
				markers: buildMarkers(
					svg,
					`os-window-link-${ seq }${ suffix }`,
				),
			};
		};
		const surfaces = {
			base: buildSurface( ctx.container, '' ),
			elevated: buildSurface( ctx.elevatedContainer, '-elevated' ),
		};

		const edges = new Map<
			string,
			EdgeElements & { surface: 'base' | 'elevated' }
		>();

		const draw = ( frame: WindowLinkFrame ): void => {
			for ( const { svg } of [ surfaces.base, surfaces.elevated ] ) {
				svg.setAttribute( 'width', String( frame.container.width ) );
				svg.setAttribute(
					'height',
					String( frame.container.height ),
				);
				svg.setAttribute(
					'viewBox',
					`0 0 ${ frame.container.width } ${ frame.container.height }`,
				);
			}

			const seen = new Set< string >();
			for ( const edge of frame.edges ) {
				if ( ! edge.from || ! edge.to ) {
					continue;
				}
				const key = `${ edge.fromWindowId }→${ edge.toWindowId }:${ edge.kind }`;
				seen.add( key );

				const surfaceName = edge.elevated ? 'elevated' : 'base';
				let el = edges.get( key );
				if ( el && el.surface !== surfaceName ) {
					el.group.remove();
					edges.delete( key );
					el = undefined;
				}
				if ( ! el ) {
					const group = document.createElementNS( SVG_NS, 'g' );
					group.classList.add( 'os-window-link' );
					const path = document.createElementNS( SVG_NS, 'path' );
					path.classList.add( 'os-window-link__path' );
					group.appendChild( path );
					surfaces[ surfaceName ].svg.appendChild( group );
					el = { group, path, surface: surfaceName };
					edges.set( key, el );
				}

				const obstacles = frame.obstacles ?? [];

				const shortest = closestBorderAnchors( edge.from, edge.to );
				const visibleAt = (
					anchor: LinkAnchor,
					zIndex: number | null,
					windowId: string,
				): boolean =>
					zIndex === null ||
					isPointVisible( anchor, zIndex, obstacles, windowId );

				let start: LinkAnchor | null = null;
				if (
					shortest &&
					visibleAt(
						shortest.from,
						edge.fromZIndex,
						edge.fromWindowId,
					)
				) {
					start = shortest.from;
				}
				if ( ! start ) {
					start = endpointAnchor(
						edge.from,
						edge.fromZIndex,
						edge.fromWindowId,
						obstacles,
						shortest
							? { x: shortest.to.x, y: shortest.to.y }
							: centerOf( edge.to ),
					);
				}

				let end: LinkAnchor | null = null;
				if (
					shortest &&
					visibleAt( shortest.to, edge.toZIndex, edge.toWindowId )
				) {
					end = shortest.to;
				}
				if ( ! end ) {
					end = endpointAnchor(
						edge.to,
						edge.toZIndex,
						edge.toWindowId,
						obstacles,

						{ x: start.x, y: start.y },
					);
				}
				const distance = Math.hypot(
					end.x - start.x,
					end.y - start.y,
				);
				const c1 = controlPoint( start, distance );
				const c2 = controlPoint( end, distance );

				el.path.setAttribute(
					'd',
					`M ${ start.x } ${ start.y } C ${ c1.x } ${ c1.y }, ${ c2.x } ${ c2.y }, ${ end.x } ${ end.y }`,
				);

				const markers = surfaces[ el.surface ].markers;
				const variant = edge.focused ? 'active' : 'normal';
				el.path.setAttribute(
					'marker-end',
					`url(#${ markers.dot[ variant ] })`,
				);
				el.path.setAttribute(
					'marker-start',
					`url(#${
						edge.bidirectional
							? markers.dot[ variant ]
							: markers.port[ variant ]
					})`,
				);
				el.group.classList.toggle(
					'os-window-link--active',
					edge.focused,
				);
			}

			for ( const [ key, el ] of Array.from( edges ) ) {
				if ( ! seen.has( key ) ) {
					el.group.remove();
					edges.delete( key );
				}
			}
		};

		const unsubscribe = ctx.onFrame( draw );
		draw( ctx.getFrame() );

		return () => {
			unsubscribe();
			edges.clear();
			surfaces.base.svg.remove();
			surfaces.elevated.svg.remove();
		};
	},
} );
