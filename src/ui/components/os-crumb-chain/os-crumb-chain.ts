import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';
import { styles } from './os-crumb-chain.styles';

export interface OsCrumbSegment {
	id?: number | string;
	name: string;

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
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-crumb__remove' ) ) {
			e.preventDefault();
			return;
		}
		const dragSegments = this._segments.slice( index );

		if ( e.dataTransfer ) {
			const ghost = buildDragGhost( dragSegments );
			document.body.appendChild( ghost );

			const rect = (
				e.currentTarget as HTMLElement | null
			)?.getBoundingClientRect();
			const offsetX = rect ? Math.min( 30, rect.width / 2 ) : 16;
			const offsetY = rect ? Math.min( 16, rect.height / 2 ) : 12;
			e.dataTransfer.setDragImage( ghost, offsetX, offsetY );
			requestAnimationFrame( () => ghost.remove() );
		}

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

		'position: fixed',
		'top: -10000px',
		'left: -10000px',
		'pointer-events: none',
		'z-index: 2147483647',
	].join( '; ' );
	const total = segments.length;

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

const NEUTRAL_CRUMB_BG = 'rgba( 0, 0, 0, 0.08 )';
const NEUTRAL_CRUMB_FG = '#1d2327';

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

let _readbackCanvas: HTMLCanvasElement | null = null;
function pickForegroundColor( bg: string ): string {
	if ( ! _readbackCanvas ) {
		_readbackCanvas = document.createElement( 'canvas' );
		_readbackCanvas.width = 1;
		_readbackCanvas.height = 1;
	}

	const ctx = _readbackCanvas.getContext( '2d', { willReadFrequently: true } );
	if ( ! ctx ) {
		return '#1d2327';
	}
	try {
		ctx.clearRect( 0, 0, 1, 1 );
		ctx.fillStyle = bg;
		ctx.fillRect( 0, 0, 1, 1 );
		const data = ctx.getImageData( 0, 0, 1, 1 ).data;

		const a = data[ 3 ] / 255;
		const r = data[ 0 ] * a + 255 * ( 1 - a );
		const g = data[ 1 ] * a + 255 * ( 1 - a );
		const b = data[ 2 ] * a + 255 * ( 1 - a );

		const lin = ( c: number ): number => {
			const v = c / 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow( ( v + 0.055 ) / 1.055, 2.4 );
		};
		const L = 0.2126 * lin( r ) + 0.7152 * lin( g ) + 0.0722 * lin( b );

		return L > 0.55 ? '#1d2327' : '#fff';
	} catch {
		return '#1d2327';
	}
}

function _iconCross() {
	return osIcon( 'close', { size: null } );
}
