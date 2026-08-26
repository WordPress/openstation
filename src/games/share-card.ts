/**
 * Games framework — shareable score card.
 *
 * Renders a finished run as a polished 1200×630 image on a plain
 * `<canvas>` (2D API, no assets, no network) that the player can
 * share, copy, or save. Deliberately JUST an image: the admin is a
 * private space, so there is no URL, no caption, no tracking —
 * the card itself is the whole payload.
 *
 * One-tap share prefers the native share sheet with the PNG
 * attached (`navigator.share` + files); when that is unavailable
 * it falls back to copying the image to the clipboard, and finally
 * to a plain download. `shareScoreCard()` reports which path ran
 * so the caller can toast accordingly.
 *
 * Framework-level so every game renders the same recognizable
 * card; the caller provides already-translated labels.
 */

export interface ShareCardStat {
	label: string;
	value: string;
}

export interface ShareCardData {
	/** Game name, e.g. "Alphabet Soup". */
	gameTitle: string;
	/** Mode + seed tag, e.g. "Daily · 18-07-2026". */
	puzzleLabel: string;
	/** Big-number headline. */
	score: number;
	/** Label under the big number, e.g. "points". */
	scoreLabel: string;
	/** Up to five supporting stats, left to right. */
	stats: ShareCardStat[];
	/** Small footer branding, e.g. "WordPress OpenStation". */
	footer: string;
	/** Accent color for the score + trims. */
	accent?: string;
}

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** Decorative letter-tile positions — fixed, so cards are stable. */
const DECO_TILES: ReadonlyArray<
	readonly [ number, number, number, number ]
> = [
	// x, y, size, rotation (radians)
	[ 1020, 96, 74, -0.16 ],
	[ 1108, 210, 56, 0.22 ],
	[ 966, 250, 44, 0.42 ],
	[ 1084, 356, 66, -0.28 ],
	[ 90, 520, 54, 0.18 ],
	[ 170, 570, 40, -0.32 ],
];

const DECO_COLORS: readonly string[] = [
	'#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#90e0ef',
];

const CARD_FONT = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif';

/**
 * Paint the card. Fixed 1200×630 backing size regardless of the
 * canvas's CSS size (callers scale it with CSS).
 */
export function renderShareCard(
	canvas: HTMLCanvasElement,
	data: ShareCardData,
): void {
	canvas.width = SHARE_CARD_WIDTH;
	canvas.height = SHARE_CARD_HEIGHT;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		return;
	}
	const accent = data.accent ?? '#ffd166';
	const w = SHARE_CARD_WIDTH;
	const h = SHARE_CARD_HEIGHT;

	// --- Backdrop: deep pot + simmering glows -----------------------
	ctx.fillStyle = '#1c1233';
	ctx.fillRect( 0, 0, w, h );
	const glowA = ctx.createRadialGradient( w * 0.2, h * 0.1, 40, w * 0.2, h * 0.1, 620 );
	glowA.addColorStop( 0, 'rgba(105, 78, 189, 0.55)' );
	glowA.addColorStop( 1, 'rgba(105, 78, 189, 0)' );
	ctx.fillStyle = glowA;
	ctx.fillRect( 0, 0, w, h );
	const glowB = ctx.createRadialGradient( w * 0.92, h * 0.95, 40, w * 0.92, h * 0.95, 560 );
	glowB.addColorStop( 0, 'rgba(41, 128, 185, 0.4)' );
	glowB.addColorStop( 1, 'rgba(41, 128, 185, 0)' );
	ctx.fillStyle = glowB;
	ctx.fillRect( 0, 0, w, h );

	// --- Decorative letter tiles ------------------------------------
	const letters = ( data.gameTitle.replace( /[^a-z]/gi, '' ) || 'ABC' ).toUpperCase();
	DECO_TILES.forEach( ( [ x, y, size, rotation ], i ) => {
		ctx.save();
		ctx.translate( x, y );
		ctx.rotate( rotation );
		ctx.globalAlpha = 0.16;
		ctx.fillStyle = DECO_COLORS[ i % DECO_COLORS.length ];
		roundRectPath( ctx, -size / 2, -size / 2, size, size, size * 0.24 );
		ctx.fill();
		ctx.globalAlpha = 0.4;
		ctx.fillStyle = '#ffffff';
		ctx.font = `700 ${ Math.round( size * 0.56 ) }px ${ CARD_FONT }`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( letters[ i % letters.length ], 0, size * 0.04 );
		ctx.restore();
	} );

	// --- Header: title + puzzle pill --------------------------------
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = accent;
	ctx.beginPath();
	ctx.arc( 96, 104, 14, 0, Math.PI * 2 );
	ctx.fill();
	ctx.fillStyle = '#f3efff';
	ctx.font = `700 52px ${ CARD_FONT }`;
	ctx.fillText( data.gameTitle, 130, 122 );

	ctx.font = `600 26px ${ CARD_FONT }`;
	const pillText = data.puzzleLabel;
	const pillWidth = ctx.measureText( pillText ).width + 56;
	roundRectPath( ctx, 96, 156, pillWidth, 54, 27 );
	ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
	ctx.fill();
	ctx.fillStyle = 'rgba(243, 239, 255, 0.85)';
	ctx.fillText( pillText, 124, 192 );

	// --- The big number ---------------------------------------------
	const scoreText = formatScore( data.score );
	const scoreGradient = ctx.createLinearGradient( 96, 260, 96, 420 );
	scoreGradient.addColorStop( 0, '#ffffff' );
	scoreGradient.addColorStop( 1, accent );
	ctx.fillStyle = scoreGradient;
	ctx.font = `700 150px ${ CARD_FONT }`;
	ctx.fillText( scoreText, 90, 420 );
	const scoreWidth = ctx.measureText( scoreText ).width;
	ctx.fillStyle = 'rgba(243, 239, 255, 0.65)';
	ctx.font = `600 30px ${ CARD_FONT }`;
	ctx.fillText( data.scoreLabel, 100 + scoreWidth, 418 );

	// --- Stat tiles --------------------------------------------------
	const stats = data.stats.slice( 0, 5 );
	if ( stats.length > 0 ) {
		const gap = 18;
		const tileW = Math.min(
			200,
			( w - 192 - gap * ( stats.length - 1 ) ) / stats.length,
		);
		const tileH = 108;
		const top = 462;
		stats.forEach( ( stat, i ) => {
			const x = 96 + i * ( tileW + gap );
			roundRectPath( ctx, x, top, tileW, tileH, 18 );
			ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
			ctx.fill();
			ctx.fillStyle = '#ffffff';
			ctx.font = `700 40px ${ CARD_FONT }`;
			ctx.fillText( stat.value, x + 22, top + 56 );
			ctx.fillStyle = 'rgba(243, 239, 255, 0.6)';
			ctx.font = `600 20px ${ CARD_FONT }`;
			ctx.fillText( stat.label.toUpperCase(), x + 22, top + 90 );
		} );
	}

	// --- Footer branding --------------------------------------------
	ctx.textAlign = 'right';
	ctx.fillStyle = 'rgba(243, 239, 255, 0.5)';
	ctx.font = `600 22px ${ CARD_FONT }`;
	ctx.fillText( data.footer, w - 60, h - 40 );
}

/** Thousands-separated score. */
export function formatScore( score: number ): string {
	return Math.max( 0, Math.round( score ) ).toLocaleString();
}

function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	ctx.beginPath();
	ctx.moveTo( x + radius, y );
	ctx.arcTo( x + width, y, x + width, y + height, radius );
	ctx.arcTo( x + width, y + height, x, y + height, radius );
	ctx.arcTo( x, y + height, x, y, radius );
	ctx.arcTo( x, y, x + width, y, radius );
	ctx.closePath();
}

/** The canvas as a PNG blob (null when the browser refuses). */
export function cardBlob(
	canvas: HTMLCanvasElement,
): Promise< Blob | null > {
	return new Promise( ( resolve ) => {
		canvas.toBlob( ( blob ) => resolve( blob ), 'image/png' );
	} );
}

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'failed';

interface NavigatorWithShare {
	share?: ( data: { files?: File[]; title?: string } ) => Promise< void >;
	canShare?: ( data: { files?: File[] } ) => boolean;
	clipboard?: {
		write?: ( items: ClipboardItem[] ) => Promise< void >;
	};
}

/**
 * One-tap share: native share sheet with the PNG attached, else
 * copy the image to the clipboard, else download it.
 *
 * @param canvas   A canvas already painted by `renderShareCard()`.
 * @param filename Download filename (e.g. `alphabet-soup-score.png`).
 * @param title    Share-sheet title (some targets display it).
 */
export async function shareScoreCard(
	canvas: HTMLCanvasElement,
	filename: string,
	title: string,
): Promise< ShareOutcome > {
	const blob = await cardBlob( canvas );
	if ( ! blob ) {
		return 'failed';
	}
	const nav = window.navigator as NavigatorWithShare;
	const file = new File( [ blob ], filename, { type: 'image/png' } );
	if (
		typeof nav.share === 'function' &&
		( typeof nav.canShare !== 'function' ||
			nav.canShare( { files: [ file ] } ) )
	) {
		try {
			await nav.share( { files: [ file ], title } );
			return 'shared';
		} catch {
			// Dismissed or unsupported payload — fall through.
		}
	}
	if ( await copyCardToClipboard( blob ) ) {
		return 'copied';
	}
	downloadCard( canvas, filename );
	return 'downloaded';
}

/** Copy the PNG to the clipboard. Returns whether it worked. */
export async function copyCardToClipboard( blob: Blob ): Promise< boolean > {
	const nav = window.navigator as NavigatorWithShare;
	const ClipboardItemCtor = (
		window as unknown as { ClipboardItem?: typeof ClipboardItem }
	).ClipboardItem;
	if ( ! nav.clipboard?.write || ! ClipboardItemCtor ) {
		return false;
	}
	try {
		await nav.clipboard.write( [
			new ClipboardItemCtor( { 'image/png': blob } ),
		] );
		return true;
	} catch {
		return false;
	}
}

/** Plain download of the card PNG. */
export function downloadCard(
	canvas: HTMLCanvasElement,
	filename: string,
): void {
	const link = document.createElement( 'a' );
	link.href = canvas.toDataURL( 'image/png' );
	link.download = filename;
	link.click();
}
