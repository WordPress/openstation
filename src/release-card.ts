/**
 * The vinyl release card — an album sleeve (the release art) with a
 * CSS-drawn record that slides out; the close button fades it away.
 */

import { markNoticeDismissed } from './ui/components/os-notice/storage';
import { __ } from './i18n';

export interface ReleaseCardOptions {
	/** Full, already-translated message (e.g. `WordPress 7.0 "Armstrong" is available.`). */
	message: string;
	artUrl: string;
	/** Persistence key — the dismissal is recorded under this id. */
	dismissKey: string;
	/** Optional accent override; omit to derive it from the art. */
	accent?: string;
	accentInk?: string;
	/** Invoked when the user clicks "Update now". */
	onUpdate: () => void;
}

const STYLE_ID = 'os-release-card-styles';
const HOST_CLASS = 'os-release-host';

const WP_LOGO =
	'<svg viewBox="0 0 122.52 122.523" aria-hidden="true"><path fill="currentColor" ' +
	'd="M8.708 61.26c0 20.802 12.089 38.779 29.619 47.298L13.258 39.872a52.352 52.352 0 0 0-4.55 21.388zm87.892-2.652c0-6.495-2.333-10.993-4.334-14.494-2.664-4.329-5.161-7.995-5.161-12.324 0-4.831 3.664-9.328 8.825-9.328.233 0 .454.029.681.042-9.35-8.566-21.807-13.796-35.489-13.796-18.36 0-34.513 9.42-43.91 23.688 1.233.037 2.395.063 3.382.063 5.497 0 14.006-.667 14.006-.667 2.833-.167 3.167 3.994.337 4.329 0 0-2.847.335-6.015.501l19.138 56.925 11.502-34.493-8.187-22.432c-2.831-.166-5.51-.501-5.51-.501-2.831-.167-2.499-4.496.332-4.329 0 0 8.679.667 13.843.667 5.496 0 14.006-.667 14.006-.667 2.835-.167 3.168 3.994.337 4.329 0 0-2.852.335-6.015.501l18.992 56.494 5.242-17.517c2.272-7.269 4.001-12.49 4.001-16.989zm-34.404 7.223l-15.768 45.819a52.552 52.552 0 0 0 14.807 2.136c6.309 0 12.36-1.091 17.996-3.075a4.617 4.617 0 0 1-.374-.724L62.196 65.831zm45.192-29.81c.226 1.674.354 3.471.354 5.404 0 5.333-.996 11.328-3.996 18.824l-16.053 46.413c15.624-9.111 26.133-26.038 26.133-45.426.001-9.137-2.333-17.729-6.438-25.215zM61.262 0C27.483 0 0 27.481 0 61.26c0 33.783 27.483 61.263 61.262 61.263 33.778 0 61.265-27.48 61.265-61.263C122.526 27.481 95.04 0 61.262 0zm0 119.715c-32.23 0-58.453-26.223-58.453-58.455 0-32.23 26.222-58.451 58.453-58.451 32.229 0 58.45 26.221 58.45 58.451 0 32.232-26.221 58.455-58.45 58.455z"/></svg>';

const CLOSE_ICON =
	'<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" ' +
	'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path></svg>';

const STYLES = `
.dm-release-card {
	position: relative; box-sizing: border-box; width: 268px; padding: 11px;
	border-radius: 14px; color: #fff;
	font-family: var( --os-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif );
	background: #34373f; border: 1px solid rgba( 255, 255, 255, 0.14 );
	box-shadow: 0 16px 40px rgba( 0, 0, 0, 0.55 ), 0 3px 8px rgba( 0, 0, 0, 0.3 ), inset 0 0 0 1px rgba( 255, 255, 255, 0.04 );
	--accent: #2271b1; --accent-ink: #ffffff;
	animation: dmRcCardIn 0.5s cubic-bezier( 0.2, 1.2, 0.35, 1 ) both;
}
.dm-release-card, .dm-release-card * { box-sizing: border-box; }
@keyframes dmRcCardIn {
	from { opacity: 0; transform: translateY( -16px ) scale( 0.96 ); }
	to   { opacity: 1; transform: none; }
}
.dm-rc__close {
	position: absolute; top: 9px; right: 9px; z-index: 10;
	width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%;
	display: inline-flex; align-items: center; justify-content: center;
	background: rgba( 0, 0, 0, 0.5 ); color: #fff; opacity: 0.72; cursor: pointer;
	transition: opacity 0.12s ease, background-color 0.12s ease;
}
.dm-rc__close:hover { opacity: 1; background: rgba( 0, 0, 0, 0.7 ); }
.dm-rc__close:focus-visible { opacity: 1; outline: 2px solid #fff; outline-offset: 2px; }
.dm-rc__close svg { width: 11px; height: 11px; }
.dm-rc__art { position: relative; height: 150px; }
.dm-rc__cover {
	position: absolute; left: 2px; top: 0; width: 150px; height: 150px;
	border-radius: 2px; overflow: hidden; z-index: 3;
	box-shadow: 0 8px 20px rgba( 0, 0, 0, 0.5 ), inset 0 0 0 1px rgba( 255, 255, 255, 0.08 );
}
.dm-rc__canvas { width: 100%; height: 100%; display: block; }
.dm-rc__disc-wrap {
	position: absolute; left: 94px; top: 2px; width: 148px; height: 148px; z-index: 2;
	border-radius: 50%; box-shadow: 0 14px 26px rgba( 0, 0, 0, 0.6 );
	animation: dmRcEmerge 0.8s cubic-bezier( 0.2, 1, 0.28, 1 ) 0.45s both;
}
@keyframes dmRcEmerge {
	from { transform: translateX( -84px ); }
	to   { transform: translateX( 0 ); }
}
.dm-rc__disc {
	position: absolute; inset: 0; border-radius: 50%;
	background:
		repeating-radial-gradient( circle at 50% 50%, rgba( 255, 255, 255, 0.05 ) 0 1px, rgba( 0, 0, 0, 0 ) 1px 2.4px ),
		radial-gradient( circle at 50% 50%, #1a1a1e 0 11%, #0a0a0c 12% 62%, #050506 100% );
	box-shadow: inset 0 0 26px rgba( 0, 0, 0, 0.9 ), inset 0 0 0 1px rgba( 255, 255, 255, 0.05 );
	animation: dmRcSettle 2.5s cubic-bezier( 0.12, 0.72, 0.16, 1 ) 0.45s both;
}
@keyframes dmRcSettle {
	from { transform: rotate( 0 ); }
	to   { transform: rotate( 720deg ); }
}
.dm-rc__label {
	position: absolute; inset: 34%; border-radius: 50%; display: grid; place-items: center;
	background: var( --accent ); color: var( --accent-ink );
	box-shadow: inset 0 0 0 2px rgba( 0, 0, 0, 0.18 ), 0 1px 2px rgba( 0, 0, 0, 0.4 );
}
.dm-rc__label svg { width: 59%; height: 59%; display: block; }
.dm-rc__sheen {
	position: absolute; inset: 0; border-radius: 50%; pointer-events: none; z-index: 3;
	background: linear-gradient( 118deg, rgba( 255, 255, 255, 0.18 ) 0%, transparent 24%, transparent 74%, rgba( 255, 255, 255, 0.1 ) 100% );
	mix-blend-mode: screen;
}
.dm-rc__meta {
	display: flex; align-items: center; gap: 10px; margin-top: 11px;
	opacity: 0; animation: dmRcFade 0.5s ease 1.05s forwards;
}
@keyframes dmRcFade { to { opacity: 1; } }
.dm-rc__text { flex: 1; font-size: 13px; line-height: 1.35; color: #fff; }
.dm-rc__text b { font-weight: 650; }
.dm-rc__btn {
	flex-shrink: 0; padding: 7px 12px; border: none; border-radius: 7px;
	color: var( --accent-ink ); background: var( --accent ); font: inherit; font-size: 12px; font-weight: 600;
	cursor: pointer; box-shadow: 0 2px 8px rgba( 0, 0, 0, 0.3 ); transition: filter 0.12s;
}
.dm-rc__btn:hover { filter: brightness( 1.12 ); }
.dm-rc__btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
@media ( prefers-reduced-motion: reduce ) {
	.dm-release-card, .dm-rc__disc-wrap, .dm-rc__disc, .dm-rc__meta { animation: none !important; }
	.dm-rc__disc-wrap { transform: translateX( 0 ); }
	.dm-rc__meta { opacity: 1; }
}
`;

interface ColorBucket {
	r: number;
	g: number;
	b: number;
	n: number;
	score: number;
}

function ensureStyles(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const el = document.createElement( 'style' );
	el.id = STYLE_ID;
	el.textContent = STYLES;
	document.head.appendChild( el );
}

function ensureHost(): HTMLElement {
	const existing = document.querySelector< HTMLElement >( '.' + HOST_CLASS );
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'div' );
	el.className = HOST_CLASS;
	// Fixed top-right, above fullscreen windows — same anchor + z as the
	// toast container. Host is click-transparent; the card opts back in.
	el.style.cssText =
		'position:fixed;' +
		'top:calc(var(--wp-admin--admin-bar--height,32px) + 16px);' +
		'inset-inline-end:16px;' +
		'z-index:calc(var(--os-z-fullscreen,99999) + 10);' +
		'pointer-events:none;';
	document.body.appendChild( el );
	return el;
}

/**
 * Paint the square sleeve into the cover canvas + derive the accent from
 * it. Release art isn't visually consistent — most covers bleed to the
 * edge, some ship a uniform white frame — so we trim that frame first,
 * then take the left square (the sleeve; the record is to its right).
 * The sleeve is always drawn; the trim + accent are best-effort and skipped
 * if the canvas pixels can't be read (tainted / unsupported).
 */
function paintSleeve(
	root: HTMLElement,
	canvas: HTMLCanvasElement,
	artUrl: string,
	hasExplicitAccent: boolean,
): void {
	const img = new Image();
	img.crossOrigin = 'anonymous';
	img.addEventListener(
		'load',
		() => {
			const w = img.naturalWidth || 0;
			const h = img.naturalHeight || 0;
			if ( ! w || ! h ) {
				return;
			}
			const size = 320;
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext( '2d' );
			if ( ! ctx ) {
				return;
			}

			// Baseline: draw the left square unconditionally so the sleeve is
			// always visible (drawing a cross-origin image is fine even when
			// reading its pixels isn't).
			const baseSide = Math.min( w, h );
			ctx.drawImage( img, 0, 0, baseSide, baseSide, 0, 0, size, size );

			// Refine, best-effort: trim any uniform white frame + sample the
			// accent. Both need readable pixel data — if that throws (tainted
			// canvas), the baseline sleeve above stays.
			try {
				const work = document.createElement( 'canvas' );
				work.width = w;
				work.height = h;
				const wctx = work.getContext( '2d' );
				if ( ! wctx ) {
					return;
				}
				wctx.drawImage( img, 0, 0 );
				const data = wctx.getImageData( 0, 0, w, h ).data;

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

				const side = Math.max( 1, Math.min( right - left + 1, bottom - top + 1 ) );
				// Redraw with the trimmed crop, replacing the baseline.
				ctx.clearRect( 0, 0, size, size );
				ctx.drawImage( img, left, top, side, side, 0, 0, size, size );

				if ( ! hasExplicitAccent ) {
					extractAccent( root, ctx, size );
				}
			} catch {
				// Pixel reads not allowed (tainted canvas) — keep the baseline sleeve.
			}
		},
		{ once: true },
	);
	img.src = artUrl;
}

/** Set `--accent` / `--accent-ink` on the card from the sleeve's dominant vivid color. */
function extractAccent(
	root: HTMLElement,
	ctx: CanvasRenderingContext2D,
	size: number,
): void {
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
	root.style.setProperty( '--accent', `rgb(${ r }, ${ g }, ${ b })` );
	root.style.setProperty( '--accent-ink', lum > 0.6 ? '#1a1a1a' : '#ffffff' );
}

/**
 * Show the release card. Replaces any card already showing. Returns a
 * dismiss callback the caller can invoke early (removes without animation).
 */
export function showReleaseCard( opts: ReleaseCardOptions ): () => void {
	ensureStyles();
	const host = ensureHost();
	host.textContent = '';

	const root = document.createElement( 'div' );
	root.className = 'dm-release-card';
	root.setAttribute( 'role', 'status' );
	root.style.pointerEvents = 'auto';
	if ( opts.accent ) {
		root.style.setProperty( '--accent', opts.accent );
	}
	if ( opts.accentInk ) {
		root.style.setProperty( '--accent-ink', opts.accentInk );
	}
	root.innerHTML =
		`<button type="button" class="dm-rc__close">${ CLOSE_ICON }</button>` +
		'<div class="dm-rc__art">' +
		'<div class="dm-rc__disc-wrap"><div class="dm-rc__disc">' +
		`<div class="dm-rc__label">${ WP_LOGO }</div>` +
		'</div><div class="dm-rc__sheen"></div></div>' +
		'<div class="dm-rc__cover"><canvas class="dm-rc__canvas"></canvas></div>' +
		'</div>' +
		'<div class="dm-rc__meta"><span class="dm-rc__text"></span>' +
		'<button type="button" class="dm-rc__btn"></button></div>';

	// Message + labels as text (never interpolate untrusted content into HTML,
	// and keep the whole sentence in one translated string).
	( root.querySelector( '.dm-rc__text' ) as HTMLElement ).textContent = opts.message;

	const closeBtn = root.querySelector( '.dm-rc__close' ) as HTMLButtonElement;
	closeBtn.setAttribute( 'aria-label', __( 'Dismiss' ) );

	const updateBtn = root.querySelector( '.dm-rc__btn' ) as HTMLButtonElement;
	updateBtn.textContent = __( 'Update now' );

	host.appendChild( root );

	paintSleeve(
		root,
		root.querySelector( '.dm-rc__canvas' ) as HTMLCanvasElement,
		opts.artUrl,
		!! opts.accent,
	);

	let done = false;
	let timer: number | null = null;
	const removeNow = (): void => {
		done = true;
		if ( timer !== null ) {
			clearTimeout( timer );
			timer = null;
		}
		root.remove();
	};

	// Close button → fade out + persist so it won't reappear.
	closeBtn.addEventListener(
		'click',
		( e ) => {
			e.preventDefault();
			e.stopPropagation();
			if ( done ) {
				return;
			}
			markNoticeDismissed( opts.dismissKey );

			const reduce =
				typeof window.matchMedia === 'function' &&
				window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
			if ( reduce ) {
				removeNow();
				return;
			}
			done = true;
			// Clear the entrance animation so the inline opacity applies.
			root.style.animation = 'none';
			root.style.transition = 'opacity 0.2s ease';
			requestAnimationFrame( () => {
				root.style.opacity = '0';
			} );
			timer = window.setTimeout( () => root.remove(), 240 );
		},
	);

	updateBtn.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		opts.onUpdate();
		removeNow();
	} );

	return removeNow;
}
