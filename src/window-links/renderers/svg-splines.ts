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

/**
 * Marker ids are namespaced per mount so two shells in one document
 * (tests) can't cross-reference each other's defs.
 */
let _mountSeq = 0;

interface EdgeElements {
	group: SVGGElement;
	path: SVGPathElement;
}

/**
 * Best anchor for an edge endpoint. The classic center-ray border
 * intersection wins while it is actually VISIBLE — that keeps several
 * ties fanning naturally into the same window instead of piling onto
 * one midpoint. When that point is covered by a higher window (the
 * cascaded-comments case), the anchor relocates to the midpoint of
 * the closest visible border stretch, so the tie starts where the
 * user can see the window. A fully covered window falls back to the
 * classic anchor — the tie then honestly emerges from under the pile.
 */
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
		// Two drawing surfaces: the base layer (always behind windows)
		// and the elevated layer the host lifts to the focused group's
		// ceiling. Each edge routes by `edge.elevated`, so only the
		// focused window's ties ride above other windows. Markers are
		// per-surface (a marker reference can't cross <svg> roots).
		const seq = ++_mountSeq;
		const buildSurface = (
			container: HTMLElement,
			suffix: string,
		): { svg: SVGSVGElement; markers: { normal: string; active: string } } => {
			const svg = document.createElementNS( SVG_NS, 'svg' );
			svg.classList.add( 'desktop-mode-window-links__svg' );
			container.appendChild( svg );
			return {
				svg,
				markers: buildMarkers(
					svg,
					`desktop-mode-window-link-${ seq }${ suffix }`,
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
					continue; // an endpoint is minimized / hidden
				}
				const key = `${ edge.fromWindowId }→${ edge.toWindowId }:${ edge.kind }`;
				seen.add( key );

				const surfaceName = edge.elevated ? 'elevated' : 'base';
				let el = edges.get( key );
				if ( el && el.surface !== surfaceName ) {
					// The edge switched layers (focus moved onto / off
					// one of its endpoints) — rebuild it on the other
					// surface; markers differ per surface.
					el.group.remove();
					edges.delete( key );
					el = undefined;
				}
				if ( ! el ) {
					const group = document.createElementNS( SVG_NS, 'g' );
					group.classList.add( 'desktop-mode-window-link' );
					const path = document.createElementNS( SVG_NS, 'path' );
					path.classList.add( 'desktop-mode-window-link__path' );
					group.appendChild( path );
					surfaces[ surfaceName ].svg.appendChild( group );
					el = { group, path, surface: surfaceName };
					edges.set( key, el );
				}

				const obstacles = frame.obstacles ?? [];
				// Anchor preference, per endpoint: (1) the SHORTEST
				// edge-to-edge connection between the two windows —
				// when that point is actually visible; (2) otherwise
				// the occlusion-aware chain (classic center-ray while
				// visible, else the closest visible border stretch).
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
						// Aim the target anchor at the resolved source
						// anchor so the curve's two ends agree when
						// either moved off the shortest pair.
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

				// Direction: the arrow always points at the edge target
				// (`to` — the root / referenced window); bidirectional
				// reference edges get a second head at the start.
				const markers = surfaces[ el.surface ].markers;
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
			surfaces.base.svg.remove();
			surfaces.elevated.svg.remove();
		};
	},
} );
