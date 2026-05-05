/**
 * `<wpd-crumb-chain>` — chevron-interlocking breadcrumb chain.
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
 * `wpd-chain-remove` `{ index, id }` when × is activated on the
 * leaf. Consumers handle persistence + rollback.
 *
 * ```js
 * const chain = document.createElement( 'wpd-crumb-chain' );
 * chain.segments = [
 *     { id: 5, name: 'Tech',     color: '#2271b1' },
 *     { id: 7, name: 'Web Dev',  color: '#3a8ed4' },
 *     { id: 9, name: 'Frontend', color: '#5cb0ff' },
 * ];
 * chain.removable = true;
 * chain.addEventListener( 'wpd-chain-remove', ( e ) => {
 *     console.log( 'remove leaf', e.detail.id );
 * } );
 * ```
 *
 * @public
 * @since 0.8.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-crumb-chain.styles';

/**
 * One segment in a chain. `id` is opaque to the component — most
 * consumers map it to a server-side id (term id, taxonomy term
 * id, file path hash, …). `color` is a CSS color string applied
 * as the segment's background; the foreground (text) color is
 * picked automatically based on the perceived luminance of the
 * background so the label stays readable across hue space.
 */
export interface WpdCrumbSegment {
	id?: number | string;
	name: string;
	/** Background color. Falls back to a neutral grey when unset. */
	color?: string;
}

export class WpdCrumbChain extends Component {
	static props = [ 'removable', 'disabled' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Crumb chain',
		summary:
			'Chevron-interlocking breadcrumb. Segments slot together like puzzle pieces, with each segment in its own color so the eye reads root → leaf as a single merged path. Reusable for any parent → child → grandchild relationship.',
		status: 'experimental',
		since: '0.8.0',
		props: [
			{
				name: 'removable',
				type: 'boolean attribute',
				description:
					'Show an × on the last segment. Click / activate emits `wpd-chain-remove`.',
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
				name: 'wpd-chain-remove',
				description:
					'Fires when × on the last segment is activated. Detail carries the leaf segment + its array index for the consumer to act on.',
				detail: '{ index: number; id?: number | string; segment: WpdCrumbSegment }',
			},
			{
				name: 'wpd-chain-segment-click',
				description:
					'Fires when ANY segment is clicked. Useful for navigation drills (click "Tech" to filter to Tech).',
				detail: '{ index: number; id?: number | string; segment: WpdCrumbSegment }',
			},
		],
		example: html`
			<wpd-crumb-chain id="example-chain" removable></wpd-crumb-chain>
			<script>
				document.getElementById( 'example-chain' ).segments = [
					{ id: 1, name: 'Tech', color: '#2271b1' },
					{ id: 2, name: 'Web Dev', color: '#3a8ed4' },
					{ id: 3, name: 'Frontend', color: '#5cb0ff' },
				];
			</script>
		`,
	} as const;

	private _segments: WpdCrumbSegment[] = [];

	get segments(): WpdCrumbSegment[] {
		return this._segments;
	}
	set segments( next: readonly WpdCrumbSegment[] | null | undefined ) {
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
			<div class="wpd-crumb-chain" role="group">
				${ segments.map( ( seg, idx ) => {
					const variant = pickVariant( idx, segments.length );
					const bg = seg.color ?? 'rgba( 0, 0, 0, 0.08 )';
					const fg = pickForegroundColor( bg );
					const styleStr = `--wpd-crumb-bg: ${ bg }; --wpd-crumb-fg: ${ fg };`;
					return html`
						<span
							class=${ `wpd-crumb wpd-crumb--${ variant }` }
							style=${ styleStr }
							title=${ seg.name }
							@click=${ ( e: MouseEvent ) =>
								this._onSegmentClick( e, idx, seg ) }
						>
							<span class="wpd-crumb__label">${ seg.name }</span>
							${ removable
								? html`
										<button
											type="button"
											class="wpd-crumb__remove"
											aria-label=${ `Remove ${ seg.name }` }
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

	private _onSegmentClick(
		e: MouseEvent,
		index: number,
		segment: WpdCrumbSegment,
	): void {
		// Don't double-fire when the click was on the remove button.
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.wpd-crumb__remove' ) ) {
			return;
		}
		this.emit( 'wpd-chain-segment-click', {
			index,
			id: segment.id,
			segment,
		} );
	}

	private _onRemove(
		e: MouseEvent,
		index: number,
		segment: WpdCrumbSegment,
	): void {
		e.stopPropagation();
		this.emit( 'wpd-chain-remove', { index, id: segment.id, segment } );
	}
}
defineComponent( 'wpd-crumb-chain', WpdCrumbChain );

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
 * (matches every `wpd-*` host) and apply the alpha before
 * computing luminance.
 */
let _readbackCanvas: HTMLCanvasElement | null = null;
function pickForegroundColor( bg: string ): string {
	if ( ! _readbackCanvas ) {
		_readbackCanvas = document.createElement( 'canvas' );
		_readbackCanvas.width = 1;
		_readbackCanvas.height = 1;
	}
	const ctx = _readbackCanvas.getContext( '2d' );
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
	return html`
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			focusable="false"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M3 3 L9 9 M9 3 L3 9" />
		</svg>
	`;
}
