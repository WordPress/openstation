/**
 * Inkfall — Pixi scene: the notebook page and the falling words.
 *
 * All visuals are vector (`Graphics`) + `Text` — no image assets.
 * The page is warm paper with soft ruled lines and a red margin
 * line; words render as ink text, with the matched prefix in an
 * accent color (two Text objects inside one container so we never
 * pay per-character Text until the tear effect).
 *
 * @since 0.9.6
 */

import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from '../pixi-types';

export const INK_COLOR = 0x2b3a55;
export const ACCENT_COLOR = 0x8e44ad;
export const PAPER_COLOR = 0xf7f3e8;
export const RULE_COLOR = 0xbcd4e6;
export const MARGIN_COLOR = 0xe8a1a1;

export const WORD_FONT = 'Georgia, "Times New Roman", serif';
export const WORD_FONT_SIZE = 26;

const RULE_SPACING = 32;

/** One falling word's display state. */
export interface WordSprite {
	container: PixiContainer;
	matched: PixiText;
	rest: PixiText;
	text: string;
	/** Total rendered width (for centering + char positions). */
	width: number;
}

/** Paint (or repaint, on resize) the notebook-page background. */
export function paintPaper(
	graphics: PixiGraphics,
	width: number,
	height: number,
): void {
	graphics.clear();
	graphics.rect( 0, 0, width, height ).fill( { color: PAPER_COLOR } );
	for ( let y = RULE_SPACING; y < height; y += RULE_SPACING ) {
		graphics
			.moveTo( 0, y )
			.lineTo( width, y )
			.stroke( { color: RULE_COLOR, width: 1, alpha: 0.55 } );
	}
	const marginX = Math.min( 64, Math.round( width * 0.08 ) );
	graphics
		.moveTo( marginX, 0 )
		.lineTo( marginX, height )
		.stroke( { color: MARGIN_COLOR, width: 2, alpha: 0.7 } );
	// A soft "page bottom" edge the words are racing toward.
	graphics
		.moveTo( 0, height - 6 )
		.lineTo( width, height - 6 )
		.stroke( { color: INK_COLOR, width: 2, alpha: 0.25 } );
}

/** Build the two-Text word container. Caller positions + adds it. */
export function buildWordSprite(
	pixi: PixiNamespace,
	text: string,
): WordSprite {
	const container = new pixi.Container();
	const style = {
		fill: INK_COLOR,
		fontSize: WORD_FONT_SIZE,
		fontFamily: WORD_FONT,
	};
	const matched = new pixi.Text( { text: '', style: { ...style, fill: ACCENT_COLOR } } );
	const rest = new pixi.Text( { text, style } );
	container.addChild( matched, rest );
	return { container, matched, rest, text, width: rest.width };
}

/** Update the matched-prefix split on a word sprite. */
export function setMatchedCount( sprite: WordSprite, count: number ): void {
	const clamped = Math.max( 0, Math.min( count, sprite.text.length ) );
	sprite.matched.text = sprite.text.slice( 0, clamped );
	sprite.rest.text = sprite.text.slice( clamped );
	sprite.rest.x = clamped > 0 ? sprite.matched.width : 0;
}
