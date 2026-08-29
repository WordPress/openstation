/**
 * `<os-crumb-chain>` — chevron-interlocking breadcrumb chain.
 *
 * A row of pill segments where each segment has a chevron-shaped
 * trailing edge that slots cleanly into the next segment's
 * matching leading notch — visually they read as one merged
 * "breadcrumb path" with internal tear-lines separating each
 * hierarchy level. Each segment paints in its own color so the
 * eye reads the gradient root → leaf as it scans left → right.
 *
 * Built for the Posts-window Categories cell, but tone-agnostic
 * and reusable: any `parent → child → grandchild` relationship
 * (taxonomy paths, file-system breadcrumbs, navigation trails)
 * can be rendered with this component.
 *
 * Pure presentation + event-driven. Pass `segments`; emit
 * `os-chain-remove` `{ index, id, segment }` when × is activated
 * on any segment. Consumers handle persistence + rollback.
 *
 * ```js
 * const chain = document.createElement( 'os-crumb-chain' );
 * chain.segments = [
 *     { id: 5, name: 'Tech',     color: '#2271b1' },
 *     { id: 7, name: 'Web Dev',  color: '#3a8ed4' },
 *     { id: 9, name: 'Frontend', color: '#5cb0ff' },
 * ];
 * chain.removable = true;
 * chain.addEventListener( 'os-chain-remove', ( e ) => {
 *     console.log( 'remove leaf', e.detail.id );
 * } );
 * ```
 *
 * @public
 */

import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';
import { styles } from './os-crumb-chain.styles';

/**
 * One segment in a chain. `id` is opaque to the component — most
 * consumers map it to a server-side id (term id, taxonomy term
 * id, file path hash, …). `color` is a CSS color string applied
 * as the segment's background; the foreground (text) color is
 * picked automatically based on the perceived luminance of the
 * background so the label stays readable across hue space.
 */
export interface OsCrumbSegment {
	id?: number | string;
	name: string;
	/**
	 * Background color. Left unset, the segment paints the neutral
	 * crumb from `--os-ui-crumb-bg` / `--os-ui-crumb-fg` — which a
	 * desktop theme and the palette can both re-point, and an inline
	 * default could not.
	 */
	color?: string;
}

export class OsCrumbChain extends Component {
	static props = [ 'removable', 'disabled' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Crumb chain',
		summary:
			'Chevron-interlocking breadcrumb. Segments slot together like puzzle pieces, with each segment in its own color so the eye reads root → leaf as a single merged path. Reusable for any parent → child → grandchild relationship.',
		status: 'stable',
		props: [
			{
				name: 'removable',
				type: 'boolean attribute',
				description:
					'Show an × on every segment. Activating it emits `os-chain-remove` with the clicked segment + index — consumers cascade the removal down the chain (segment + descendants).',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description:
					'Visually mute the chain and ignore pointer + keyboard input.',
			},
		],
		events: [
			{
				name: 'os-chain-remove',
				description:
					'Fires when × on ANY segment is activated. Detail carries the clicked segment + its index. Consumers typically delete the segment AND every descendant in the chain (mirrors the drag semantic, where the same gesture would carry the same set of ids).',
				detail: '{ index: number; id?: number | string; segment: OsCrumbSegment }',
			},
			{
				name: 'os-chain-segment-click',
				description:
					'Fires when ANY segment is clicked. Useful for navigation drills (click "Tech" to filter to Tech).',
				detail: '{ index: number; id?: number | string; segment: OsCrumbSegment }',
			},
			{
				name: 'os-chain-segment-dragstart',
				description:
					'Fires when a drag begins from any segment OTHER than the × remove button. Detail carries the segments from the drag-source to the leaf so consumers can ship ids for "this branch" — a drag from the middle segment moves the segment + every descendant in the chain.',
				detail:
					'{ index: number; id?: number | string; segment: OsCrumbSegment; segments: OsCrumbSegment[]; dragEvent: DragEvent }',
			},
		],
		/*
		 * The chain takes its data through the `segments` PROPERTY,
		 * so there is no markup that can fill it — hence the
		 * `exampleInit` hook rather than a `<script>` in the template.
		 * A script here would never have run: the template is compiled
		 * through `innerHTML`, which flags parsed scripts as already
		 * started, and the cloning steps copy that flag.
		 */
		example: html`<os-crumb-chain removable></os-crumb-chain>`,
		exampleInit: ( root: HTMLElement ) => {
			const chain = root.querySelector( 'os-crumb-chain' );
			if ( chain ) {
				( chain as OsCrumbChain ).segments = [
					{ id: 1, name: 'Tech', color: '#4b3eff' },
					{ id: 2, name: 'Web Dev', color: '#a580ff' },
					{ id: 3, name: 'Frontend', color: '#f252fc' },
				];
			}
		},
	} as const;

	private _segments: OsCrumbSegment[] = [];

	get segments(): OsCrumbSegment[] {
		return this._segments;
	}
	set segments( next: readonly OsCrumbSegment[] | null | undefined ) {
		this._segments = Array.isArray( next ) ? next.slice() : [];
		this.requestUpdate();
	}

	protected render() {
		const removable =
			( this as unknown as { removable: string | null } ).removable !== null;
		const segments = this._segments;
		if ( segments.length === 0 ) {
			return html``;
		}

		return html`
			<div class="os-crumb-chain" role="group">
				${ segments.map( ( seg, idx ) => {
					const variant = pickVariant( idx, segments.length );
					/*
					 * A segment WITHOUT a colour of its own carries no
					 * inline paint at all — an empty attribute value is
					 * removed outright, so the stylesheet's
					 * `var( --os-ui-crumb-bg, … )` chain is what answers,
					 * and a desktop theme or the palette can reach it.
					 *
					 * It used to hard-code `rgba( 0, 0, 0, 0.08 )` here
					 * and let `pickForegroundColor()` derive `#1d2327`
					 * ink for that (correct arithmetic — the wash IS
					 * light, on a white page). Inline custom properties
					 * outrank every document-tree declaration, so both
					 * survived the brand: a black wash on Obsidian with
					 * near-black ink on top, 1.2:1, which is what the
					 * Posts window's Categories column was painting.
					 *
					 * Nothing downstream needed adding. The palette has
					 * named `--os-ui-crumb-bg` since the rebrand, in the
					 * "fills that must stay fills" block, and the Legacy
					 * manifest declares both — neither had ever reached
					 * this component. The ink falls through to
					 * `--os-ui-fg` and always did.
					 */
					const own = seg.color;
					const styleStr = own
						? `--os-ui-crumb-bg: ${ own }; --os-ui-crumb-fg: ${ pickForegroundColor( own ) };`
						: '';
					return html`
						<span
							class=${ `os-crumb os-crumb--${ variant }` }
							style=${ styleStr }
							title=${ seg.name }
							draggable="true"
							@click=${ ( e: MouseEvent ) =>
								this._onSegmentClick( e, idx, seg ) }
							@dragstart=${ ( e: DragEvent ) =>
								this._onSegmentDragStart( e, idx, seg ) }
						>
							<span class="os-crumb__label">${ seg.name }</span>
							${ removable
								? html`
										<button
											type="button"
											class="os-crumb__remove"
											aria-label=${ `Remove ${ seg.name }` }
											draggable="false"
											@click=${ ( e: MouseEvent ) =>
												this._onRemove( e, idx, seg ) }
										>${ _iconCross() }</button>
								  `
								: html`` }
						</span>
					`;
				} ) }
			</div>
		`;
	}

	private _onSegmentDragStart(
		e: DragEvent,
		index: number,
		segment: OsCrumbSegment,
	): void {
		// Drag from the × button must remain a "remove the leaf"
		// click — never start a drag. Bailing here AND marking the
		// button `draggable="false"` keeps the gesture working even
		// if a future browser starts honoring drag from non-draggable
		// children of draggable parents.
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-crumb__remove' ) ) {
			e.preventDefault();
			return;
		}
		const dragSegments = this._segments.slice( index );
		// Custom drag image: render the source segment + every
		// descendant to its right as their own little chevron chain.
		// The native default drag image is a snapshot of the single
		// grabbed segment, which doesn't communicate that the whole
		// branch is moving. setDragImage captures synchronously, so
		// the ghost element must already be on-screen with its real
		// pixels — we attach to body offscreen, snapshot, and remove
		// on the next animation frame.
		if ( e.dataTransfer ) {
			const ghost = buildDragGhost( dragSegments );
			document.body.appendChild( ghost );
			// Anchor the snapshot near the grab point so the ghost
			// doesn't lurch when the drag begins.
			const rect = (
				e.currentTarget as HTMLElement | null
			)?.getBoundingClientRect();
			const offsetX = rect ? Math.min( 30, rect.width / 2 ) : 16;
			const offsetY = rect ? Math.min( 16, rect.height / 2 ) : 12;
			e.dataTransfer.setDragImage( ghost, offsetX, offsetY );
			requestAnimationFrame( () => ghost.remove() );
		}
		// Drag carries the segment AT the source PLUS every descendant
		// to its right — so dragging the middle of [a > b > c] hands
		// the consumer [b, c]. The consumer fills `dataTransfer` with
		// whatever payload makes sense for its taxonomy.
		this.emit( 'os-chain-segment-dragstart', {
			index,
			id: segment.id,
			segment,
			segments: dragSegments,
			dragEvent: e,
		} );
	}

	private _onSegmentClick(
		e: MouseEvent,
		index: number,
		segment: OsCrumbSegment,
	): void {
		// Don't double-fire when the click was on the remove button.
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-crumb__remove' ) ) {
			return;
		}
		this.emit( 'os-chain-segment-click', {
			index,
			id: segment.id,
			segment,
		} );
	}

	private _onRemove(
		e: MouseEvent,
		index: number,
		segment: OsCrumbSegment,
	): void {
		e.stopPropagation();
		this.emit( 'os-chain-remove', { index, id: segment.id, segment } );
	}
}
defineComponent( 'os-crumb-chain', OsCrumbChain );

/**
 * Vanilla DOM render of a segment list, styled to match the chain's
 * shadow-DOM appearance. Used as the drag image so the user sees
 * the source segment + its descendants moving together — not just
 * the single grabbed pill. Inlined CSS because shadow-DOM
 * stylesheets don't apply to elements outside the shadow tree, and
 * `setDragImage` captures synchronously so we can't wait for a
 * `<os-crumb-chain>` clone to render on its microtask.
 */
const DRAG_GHOST_CHEVRON = 10;
function buildDragGhost( segments: readonly OsCrumbSegment[] ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = [
		'display: inline-flex',
		'align-items: stretch',
		'border-radius: 999px',
		'overflow: hidden',
		'filter: drop-shadow( 0 1px 2px rgba( 0, 0, 0, 0.18 ) )',
		'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		'font-size: 12px',
		'line-height: 1',
		'font-weight: 500',
		// Position offscreen but rendered — display:none / visibility:
		// hidden produce a blank drag-image snapshot.
		'position: fixed',
		'top: -10000px',
		'left: -10000px',
		'pointer-events: none',
		'z-index: 2147483647',
	].join( '; ' );
	const total = segments.length;
	// The ghost is rasterised by the browser from a detached snapshot,
	// so it cannot defer to the stylesheet the way a rendered chain
	// does — it has to resolve the neutral tokens itself.
	const neutral = neutralCrumbPaint();
	segments.forEach( ( seg, idx ) => {
		const span = document.createElement( 'span' );
		const bg = seg.color ?? neutral.bg;
		const fg = seg.color ? pickForegroundColor( seg.color ) : neutral.fg;
		const variant = pickVariant( idx, total );
		const styleParts: string[] = [
			'display: inline-flex',
			'align-items: center',
			'justify-content: center',
			'min-height: 22px',
			`background: ${ bg }`,
			`color: ${ fg }`,
			'white-space: nowrap',
			'box-sizing: border-box',
			'letter-spacing: 0.01em',
		];
		const c = DRAG_GHOST_CHEVRON;
		if ( variant === 'solo' ) {
			styleParts.push( 'padding: 2px 12px', 'border-radius: 999px' );
		} else if ( variant === 'first' ) {
			styleParts.push(
				'padding: 2px 22px 2px 12px',
				`clip-path: polygon( 0 0, calc( 100% - ${ c }px ) 0, 100% 50%, calc( 100% - ${ c }px ) 100%, 0 100% )`,
			);
		} else if ( variant === 'middle' ) {
			styleParts.push(
				'padding: 2px 22px',
				`margin-inline-start: -${ c }px`,
				`clip-path: polygon( ${ c }px 0, calc( 100% - ${ c }px ) 0, 100% 50%, calc( 100% - ${ c }px ) 100%, ${ c }px 100%, 0 50% )`,
			);
		} else {
			styleParts.push(
				'padding: 2px 14px 2px 22px',
				`margin-inline-start: -${ c }px`,
				`clip-path: polygon( ${ c }px 0, 100% 0, 100% 100%, ${ c }px 100%, 0 50% )`,
			);
		}
		span.style.cssText = styleParts.join( '; ' );
		span.textContent = seg.name;
		wrap.appendChild( span );
	} );
	return wrap;
}

/*
 * The pre-brand paint for a segment with no colour of its own, and the
 * floor under the tokens below. These are the literals the component
 * shipped with, so an unstyled page lands exactly where it always did.
 */
const NEUTRAL_CRUMB_BG = 'rgba( 0, 0, 0, 0.08 )';
const NEUTRAL_CRUMB_FG = '#1d2327';

/**
 * Resolve the neutral crumb's paint from the document.
 *
 * Only the drag ghost needs this: a rendered chain leaves an
 * uncoloured segment's `style` attribute off entirely and lets the
 * stylesheet's `var( --os-ui-crumb-bg, … )` chain resolve, which is
 * what keeps the palette and every desktop theme in reach. The ghost
 * is built detached and snapshotted, so it reads the same two tokens
 * directly and falls back to the literals when nothing declares them.
 */
function neutralCrumbPaint(): { bg: string; fg: string } {
	if ( typeof document === 'undefined' || ! document.body ) {
		return { bg: NEUTRAL_CRUMB_BG, fg: NEUTRAL_CRUMB_FG };
	}
	const style = getComputedStyle( document.body );
	return {
		bg: style.getPropertyValue( '--os-ui-crumb-bg' ).trim() || NEUTRAL_CRUMB_BG,
		fg: style.getPropertyValue( '--os-ui-crumb-fg' ).trim() || NEUTRAL_CRUMB_FG,
	};
}

function pickVariant(
	index: number,
	total: number,
): 'solo' | 'first' | 'middle' | 'last' {
	if ( total === 1 ) {
		return 'solo';
	}
	if ( index === 0 ) {
		return 'first';
	}
	if ( index === total - 1 ) {
		return 'last';
	}
	return 'middle';
}

/**
 * Pick a readable foreground (text) color for a given background.
 * Computes a quick relative luminance from any CSS color string by
 * sneaking it through a hidden `<canvas>` (single shared canvas
 * per page) and reading back the rendered RGB. Falls back to a
 * neutral dark fg on parse failure.
 *
 * Translucent inputs (e.g. `rgba(0, 0, 0, 0.08)`) need to be
 * composited over the chip's actual surface — otherwise the canvas
 * read returns the raw RGB (here `0, 0, 0`), the luminance check
 * evaluates as dark, and white text gets picked even though the
 * VISIBLE background — black at 8% opacity over a white window
 * surface — is almost-white. We default the surface to white
 * (matches every `os-*` host) and apply the alpha before
 * computing luminance.
 */
let _readbackCanvas: HTMLCanvasElement | null = null;
function pickForegroundColor( bg: string ): string {
	if ( ! _readbackCanvas ) {
		_readbackCanvas = document.createElement( 'canvas' );
		_readbackCanvas.width = 1;
		_readbackCanvas.height = 1;
	}
	// `willReadFrequently: true` tells Chrome to back the canvas with
	// a CPU buffer instead of the default GPU texture — `getImageData`
	// below would otherwise trigger a GPU-to-CPU sync on every crumb
	// render. The breadcrumb chain re-paints on every navigation in
	// My WordPress / folder windows, so this fires often enough that
	// Chrome surfaces the "willReadFrequently" perf warning.
	const ctx = _readbackCanvas.getContext( '2d', { willReadFrequently: true } );
	if ( ! ctx ) {
		return '#1d2327';
	}
	try {
		ctx.clearRect( 0, 0, 1, 1 );
		ctx.fillStyle = bg;
		ctx.fillRect( 0, 0, 1, 1 );
		const data = ctx.getImageData( 0, 0, 1, 1 ).data;
		// Composite over a white surface so translucent inputs read
		// as their visible appearance, not their raw RGB. data[3] is
		// 0–255; alpha 255 means the bg is opaque and the composite
		// is a no-op.
		const a = data[ 3 ] / 255;
		const r = data[ 0 ] * a + 255 * ( 1 - a );
		const g = data[ 1 ] * a + 255 * ( 1 - a );
		const b = data[ 2 ] * a + 255 * ( 1 - a );
		// Per W3C: relative luminance, sRGB → linear → weighted sum.
		const lin = ( c: number ): number => {
			const v = c / 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow( ( v + 0.055 ) / 1.055, 2.4 );
		};
		const L = 0.2126 * lin( r ) + 0.7152 * lin( g ) + 0.0722 * lin( b );
		// Luminance > 0.5 = light bg → dark fg, otherwise white fg.
		return L > 0.55 ? '#1d2327' : '#fff';
	} catch {
		return '#1d2327';
	}
}

function _iconCross() {
	return osIcon( 'close', { size: null } );
}
