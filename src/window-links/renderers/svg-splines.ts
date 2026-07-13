/**
 * Desktop Mode — Built-in `svg-splines` window-link renderer.
 *
 * Draws one cubic-Bézier spline per derived edge of the relation
 * graph, with direction encoded as arrowheads:
 *
 *  - `child-root` edges (a comment window → its post's window) carry
 *    a single arrowhead pointing at the root window — "belongs to";
 *  - `reference` edges (a post hyperlinking another open post) point
 *    at the referenced window; MUTUAL references arrive from the
 *    engine as one `bidirectional` edge and get arrowheads at both
 *    ends.
 *
 * Paths are keyed and reused across frames — per-frame work is only
 * `d`-attribute updates; elements are created/removed exclusively on
 * edge-structure changes.
 *
 * Registered through the very same public API a plugin's renderer
 * uses (`wp.desktop.registerWindowLinkRenderer`), so the shipped
 * default dogfoods the extensibility surface. Styling lives in
 * `assets/css/window-links.css` on the custom properties
 * `--desktop-mode-window-link-*` — themes and plugins restyle the
 * splines without touching this module.
 *
 * @since 0.9.4
 */

import { __ } from '../../i18n';
import { registerWindowLinkRenderer } from '../renderer-registry';
import type { WindowLinkFrame } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Marker ids are namespaced per mount so two shells in one document
 * (tests) can't cross-reference each other's defs.
 */
let _mountSeq = 0;

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface EdgeElements {
	group: SVGGElement;
	path: SVGPathElement;
}

/**
 * Intersection of the segment `center(rect) → toward` with the rect's
 * border, so splines anchor on window edges instead of starting under
 * the window body. Falls back to the center when the segment is
 * degenerate (concentric windows).
 */
function anchorOnBorder(
	rect: Rect,
	toward: { x: number; y: number },
): { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' } {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if ( dx === 0 && dy === 0 ) {
		return { x: cx, y: cy, side: 'right' };
	}
	// Scale factor to the first border hit along each axis.
	const sx = dx !== 0 ? rect.width / 2 / Math.abs( dx ) : Infinity;
	const sy = dy !== 0 ? rect.height / 2 / Math.abs( dy ) : Infinity;
	const s = Math.min( sx, sy );
	const x = cx + dx * s;
	const y = cy + dy * s;
	let side: 'left' | 'right' | 'top' | 'bottom';
	if ( sx <= sy ) {
		side = dx > 0 ? 'right' : 'left';
	} else {
		side = dy > 0 ? 'bottom' : 'top';
	}
	return { x, y, side };
}

/** Control-point offset along the anchor's outward edge normal. */
function controlPoint(
	anchor: { x: number; y: number; side: string },
	distance: number,
): { x: number; y: number } {
	const k = Math.min( 160, Math.max( 24, 0.4 * distance ) );
	switch ( anchor.side ) {
		case 'left':
			return { x: anchor.x - k, y: anchor.y };
		case 'right':
			return { x: anchor.x + k, y: anchor.y };
		case 'top':
			return { x: anchor.x, y: anchor.y - k };
		default:
			return { x: anchor.x, y: anchor.y + k };
	}
}

function centerOf( rect: Rect ): { x: number; y: number } {
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Build the `<defs>` arrowhead markers. Two variants (resting /
 * active) because a `<marker>` can't read its referencing path's
 * class; `orient="auto-start-reverse"` lets one marker serve both
 * `marker-end` and a flipped `marker-start` on bidirectional edges.
 */
function buildMarkers(
	svg: SVGSVGElement,
	idBase: string,
): { normal: string; active: string } {
	const defs = document.createElementNS( SVG_NS, 'defs' );
	const make = ( suffix: string, className: string ): string => {
		const id = `${ idBase }-${ suffix }`;
		const marker = document.createElementNS( SVG_NS, 'marker' );
		marker.setAttribute( 'id', id );
		marker.setAttribute( 'viewBox', '0 0 10 10' );
		marker.setAttribute( 'refX', '9' );
		marker.setAttribute( 'refY', '5' );
		marker.setAttribute( 'markerWidth', '7' );
		marker.setAttribute( 'markerHeight', '7' );
		marker.setAttribute( 'orient', 'auto-start-reverse' );
		marker.setAttribute( 'markerUnits', 'strokeWidth' );
		const tip = document.createElementNS( SVG_NS, 'path' );
		tip.setAttribute( 'd', 'M 0 1 L 9 5 L 0 9 z' );
		tip.classList.add( className );
		marker.appendChild( tip );
		defs.appendChild( marker );
		return id;
	};
	const normal = make( 'arrow', 'desktop-mode-window-link__arrow' );
	const active = make(
		'arrow-active',
		'desktop-mode-window-link__arrow--active',
	);
	svg.appendChild( defs );
	return { normal, active };
}

registerWindowLinkRenderer( {
	id: 'svg-splines',
	label: __( 'Splines' ),
	description: __(
		'Curved arrows between related windows — a single arrowhead points a comment or media window at its post; windows that reference each other get arrows on both ends.',
	),
	mount: ( ctx ) => {
		const svg = document.createElementNS( SVG_NS, 'svg' );
		svg.classList.add( 'desktop-mode-window-links__svg' );
		ctx.container.appendChild( svg );
		const markers = buildMarkers(
			svg,
			`desktop-mode-window-link-${ ++_mountSeq }`,
		);

		const edges = new Map< string, EdgeElements >();

		const draw = ( frame: WindowLinkFrame ): void => {
			svg.setAttribute( 'width', String( frame.container.width ) );
			svg.setAttribute( 'height', String( frame.container.height ) );
			svg.setAttribute(
				'viewBox',
				`0 0 ${ frame.container.width } ${ frame.container.height }`,
			);

			const seen = new Set< string >();
			for ( const edge of frame.edges ) {
				if ( ! edge.from || ! edge.to ) {
					continue; // an endpoint is minimized / hidden
				}
				const key = `${ edge.fromWindowId }→${ edge.toWindowId }:${ edge.kind }`;
				seen.add( key );

				let el = edges.get( key );
				if ( ! el ) {
					const group = document.createElementNS( SVG_NS, 'g' );
					group.classList.add( 'desktop-mode-window-link' );
					const path = document.createElementNS( SVG_NS, 'path' );
					path.classList.add( 'desktop-mode-window-link__path' );
					group.appendChild( path );
					svg.appendChild( group );
					el = { group, path };
					edges.set( key, el );
				}

				const fromCenter = centerOf( edge.from );
				const toCenter = centerOf( edge.to );
				const start = anchorOnBorder( edge.from, toCenter );
				const end = anchorOnBorder( edge.to, fromCenter );
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

				// Direction: the arrow always points at the edge target
				// (`to` — the root / referenced window); bidirectional
				// reference edges get a second head at the start.
				const marker = edge.focused ? markers.active : markers.normal;
				el.path.setAttribute( 'marker-end', `url(#${ marker })` );
				if ( edge.bidirectional ) {
					el.path.setAttribute(
						'marker-start',
						`url(#${ marker })`,
					);
				} else {
					el.path.removeAttribute( 'marker-start' );
				}
				el.group.classList.toggle(
					'desktop-mode-window-link--active',
					edge.focused,
				);
			}

			// Structure changed — drop edges whose endpoints vanished
			// (window closed / minimized / navigated away).
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
			svg.remove();
		};
	},
} );
