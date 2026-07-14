/**
 * `<wpd-release-card>` — the major-release update moment.
 *
 * A WordPress release ships music-themed "Release Edition" art
 * (Armstrong 7.0, Gene 6.9, …). This card uses that art as an album
 * **sleeve** and slides a CSS-drawn **vinyl** out from behind it — the
 * flat image never has to be cut apart, so the record can genuinely
 * emerge and spin. The sleeve is cropped from the left of the landscape
 * art (`object-position: left`), and the record's **accent color is
 * extracted from the sleeve** at runtime (its dominant vivid color) to
 * tint the label + "Update now" button — unless an `accent` attribute is
 * supplied. The "Update now" button emits `wpd-release-update`.
 *
 * It's the richer sibling of the plain update toast: the shell picks
 * this whenever the release's branch has art (major or minor), and falls
 * back to the toast otherwise. Under `prefers-reduced-motion` the card
 * renders static (record already out, no spin) — the stylesheet owns
 * that; no JS branch needed.
 *
 * Usage (normally mounted by the shell, not hand-authored):
 *
 *   <wpd-release-card
 *     art="…/7.0.jpg" version="7.0" name="Armstrong" branch="7.0"
 *   ></wpd-release-card>
 *
 * @since 0.9.3
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-release-card.styles';
import { __ } from '../../../i18n';

interface ColorBucket {
	r: number;
	g: number;
	b: number;
	n: number;
	score: number;
}

export class WpdReleaseCard extends Component {
	static props = [ 'art', 'version', 'name', 'branch', 'accent', 'accentInk' ] as const;
	static styles = [ styles ];

	private _coverTries = 0;

	static help = {
		title: 'Release card',
		summary:
			'The release update moment: the release art as an album sleeve with a CSS-drawn vinyl that slides out and spins. The label + button accent is extracted from the sleeve art. Falls back to the plain toast when a branch has no art. Emits wpd-release-update; renders static under prefers-reduced-motion.',
		status: 'experimental',
		since: '0.9.3',
		props: [
			{ name: 'art', type: 'string', description: 'URL of the release art (landscape; the left square is used as the sleeve).' },
			{ name: 'version', type: 'string', description: 'Version shown in the message (major branch when crossing, else exact).' },
			{ name: 'name', type: 'string', description: 'Release codename shown in the message; omit for a same-branch minor.' },
			{ name: 'branch', type: 'string', description: 'Major branch (e.g. "7.0") shown on the record label.' },
			{ name: 'accent', type: 'string', description: 'Optional accent override for the label + button; omit to derive it from the art.' },
			{ name: 'accent-ink', type: 'string', description: 'Optional text color over the accent.' },
		],
		events: [
			{ name: 'wpd-release-update', description: 'Fires when the "Update now" button is clicked.', detail: '{}' },
		],
		cssProps: [
			{ name: '--accent', description: 'Record-label + button color (derived from the art, or set via `accent`).' },
			{ name: '--accent-ink', description: 'Text color over the accent.' },
		],
		example: html`
			<wpd-release-card
				art="https://example.com/7.0.png" version="7.0" name="Armstrong" branch="7.0"
			></wpd-release-card>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
		// Explicit accent override (from the release filter) wins.
		const accent = this.getAttribute( 'accent' );
		if ( accent ) {
			this.style.setProperty( '--accent', accent );
		}
		const ink = this.getAttribute( 'accent-ink' );
		if ( ink ) {
			this.style.setProperty( '--accent-ink', ink );
		}
		// The base renders on a microtask; queue our image wiring after it
		// so the shadow `<img>` exists. We set `crossOrigin` *before* `src`
		// so the sleeve can be sampled for its accent (the CDN allows CORS).
		queueMicrotask( () => this._setupCover() );
	}

	protected render() {
		const version = this.getAttribute( 'version' ) ?? '';
		const name = this.getAttribute( 'name' ) ?? '';
		const branch = this.getAttribute( 'branch' ) || version;
		const suffix = name ? ` "${ name }"` : '';

		return html`
			<div class="art">
				<div class="disc-wrap">
					<div class="disc">
						<div class="label">
							<span class="lw">W</span>
							<span class="lv">${ branch }</span>
						</div>
						<span class="hole"></span>
					</div>
					<div class="sheen"></div>
				</div>
				<div class="cover">
					<canvas class="cover-canvas"></canvas>
				</div>
			</div>
			<div class="meta">
				<span class="mtext"
					>WordPress <b>${ version }</b>${ suffix } ${ __( 'is available.' ) }</span
				>
				<button
					type="button"
					class="btn"
					@click=${ ( e: Event ) => this._onUpdate( e ) }
				>
					${ __( 'Update now' ) }
				</button>
			</div>
		`;
	}

	/** Load the art (CORS-enabled) and paint the sleeve once the shadow DOM exists. */
	private _setupCover(): void {
		const canvas = this.shadowRoot?.querySelector< HTMLCanvasElement >( '.cover-canvas' );
		if ( ! canvas ) {
			if ( this._coverTries++ < 5 ) {
				requestAnimationFrame( () => this._setupCover() );
			}
			return;
		}
		const art = this.getAttribute( 'art' );
		if ( ! art ) {
			return;
		}
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.addEventListener( 'load', () => this._paintSleeve( img, canvas ), { once: true } );
		img.src = art;
	}

	/**
	 * Paint the square sleeve into the cover canvas, and derive the
	 * accent from it. Release art isn't visually consistent — most
	 * covers bleed to the edge, but some ship a uniform white frame
	 * around the artwork. We trim that frame first, then take the left
	 * square (the sleeve; the record is to its right), so both styles
	 * crop cleanly. No-op if the canvas can't be read (tainted / unsupported).
	 */
	private _paintSleeve( img: HTMLImageElement, canvas: HTMLCanvasElement ): void {
		try {
			const w = img.naturalWidth || 0;
			const h = img.naturalHeight || 0;
			if ( ! w || ! h ) {
				return;
			}
			const work = document.createElement( 'canvas' );
			work.width = w;
			work.height = h;
			const wctx = work.getContext( '2d' );
			if ( ! wctx ) {
				return;
			}
			wctx.drawImage( img, 0, 0 );
			const data = wctx.getImageData( 0, 0, w, h ).data;

			// Trim a uniform (near-)white frame if present. Full-bleed art
			// has non-white edges, so nothing is trimmed.
			const isWhite = ( x: number, y: number ): boolean => {
				const i = ( y * w + x ) * 4;
				return (
					data[ i ] > 248 &&
					data[ i + 1 ] > 248 &&
					data[ i + 2 ] > 248 &&
					data[ i + 3 ] > 200
				);
			};
			const rowWhite = ( y: number ): boolean => {
				for ( let x = 0; x < w; x += 2 ) {
					if ( ! isWhite( x, y ) ) {
						return false;
					}
				}
				return true;
			};
			const colWhite = ( x: number ): boolean => {
				for ( let y = 0; y < h; y += 2 ) {
					if ( ! isWhite( x, y ) ) {
						return false;
					}
				}
				return true;
			};
			let top = 0;
			while ( top < h - 1 && rowWhite( top ) ) {
				top++;
			}
			let bottom = h - 1;
			while ( bottom > top && rowWhite( bottom ) ) {
				bottom--;
			}
			let left = 0;
			while ( left < w - 1 && colWhite( left ) ) {
				left++;
			}
			let right = w - 1;
			while ( right > left && colWhite( right ) ) {
				right--;
			}

			// Sleeve = the left square of the trimmed artwork.
			const side = Math.max( 1, Math.min( right - left + 1, bottom - top + 1 ) );
			const size = 320;
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext( '2d' );
			if ( ! ctx ) {
				return;
			}
			ctx.drawImage( img, left, top, side, side, 0, 0, size, size );

			this._extractAccent( ctx, size );
		} catch {
			// Tainted canvas or unsupported context — leave it blank / default.
		}
	}

	/**
	 * Derive the accent from the painted sleeve's dominant vivid color:
	 * quantize, then pick the most-covered saturated hue. No-op if an
	 * explicit accent was supplied.
	 */
	private _extractAccent( ctx: CanvasRenderingContext2D, size: number ): void {
		if ( this.getAttribute( 'accent' ) ) {
			return;
		}
		const { data } = ctx.getImageData( 0, 0, size, size );
		const buckets = new Map< string, ColorBucket >();
		let best: ColorBucket | null = null;
		let bestScore = -1;
		for ( let i = 0; i < data.length; i += 4 ) {
			const r = data[ i ];
			const g = data[ i + 1 ];
			const b = data[ i + 2 ];
			if ( data[ i + 3 ] < 200 ) {
				continue;
			}
			const max = Math.max( r, g, b );
			const min = Math.min( r, g, b );
			const v = max / 255;
			const s = max === 0 ? 0 : ( max - min ) / max;
			// Skip near-black (record/graphics) and grey/near-white.
			if ( v < 0.2 || s < 0.25 ) {
				continue;
			}
			const key = `${ Math.floor( r / 16 ) },${ Math.floor( g / 16 ) },${ Math.floor( b / 16 ) }`;
			let bucket = buckets.get( key );
			if ( ! bucket ) {
				bucket = { r: 0, g: 0, b: 0, n: 0, score: 0 };
				buckets.set( key, bucket );
			}
			bucket.r += r;
			bucket.g += g;
			bucket.b += b;
			bucket.n += 1;
			bucket.score += s * v;
			if ( bucket.score > bestScore ) {
				bestScore = bucket.score;
				best = bucket;
			}
		}
		if ( ! best ) {
			return;
		}
		const r = Math.round( best.r / best.n );
		const g = Math.round( best.g / best.n );
		const b = Math.round( best.b / best.n );
		const lum = ( 0.299 * r + 0.587 * g + 0.114 * b ) / 255;
		this.style.setProperty( '--accent', `rgb(${ r }, ${ g }, ${ b })` );
		this.style.setProperty( '--accent-ink', lum > 0.6 ? '#1a1a1a' : '#ffffff' );
	}

	private _onUpdate( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.emit( 'wpd-release-update', {} );
	}
}
defineComponent( 'wpd-release-card', WpdReleaseCard );
