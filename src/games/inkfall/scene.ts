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

export interface WordSprite {
	container: PixiContainer;
	matched: PixiText;
	rest: PixiText;
	text: string;

	width: number;
}

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

	graphics
		.moveTo( 0, height - 6 )
		.lineTo( width, height - 6 )
		.stroke( { color: INK_COLOR, width: 2, alpha: 0.25 } );
}

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

export function setMatchedCount( sprite: WordSprite, count: number ): void {
	const clamped = Math.max( 0, Math.min( count, sprite.text.length ) );
	sprite.matched.text = sprite.text.slice( 0, clamped );
	sprite.rest.text = sprite.text.slice( clamped );
	sprite.rest.x = clamped > 0 ? sprite.matched.width : 0;
}
