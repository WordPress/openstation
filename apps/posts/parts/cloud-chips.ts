import { CHIP_TEXT_RES, FONT_FAMILY, hslToInt, truncate, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiText } from './canvas/pixi';
import { badgeInk, type CanvasPalette } from './canvas/palette';
import type { TermRow } from './types';

const CHIP_PAD_X = 11;
const CHIP_PAD_Y = 6;
const CHIP_GAP_HASH = 4;
const CHIP_GAP_COUNT = 8;
const CHIP_NAME_MAX_CHARS = 22;

export interface TagChip {
	container: PixiContainer;
	shadow: PixiGraphics;
	bg: PixiGraphics;
	hashText: PixiText;
	nameText: PixiText;
	countText: PixiText;
	cachedHover: boolean;
}

export interface TagBox {
	id: number;
	name: string;
	slug: string;
	description: string;
	count: number;
	hue: number;
	rotation: number;
	fontSize: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	width: number;
	height: number;
	chip: TagChip;
}

export const tagTone = ( hue: number ): number => hslToInt( hue, 70, 48 );

export function createTagChip( pixi: PixiNamespace, layer: PixiContainer, term: TermRow, fontSize: number, palette: CanvasPalette ): TagChip {
	const container = new pixi.Container();
	container.eventMode = 'static';
	container.cursor = 'pointer';
	const shadow = new pixi.Graphics();
	const bg = new pixi.Graphics();
	const text = ( value: string, fill: number, size: number, weight: string ): PixiText =>
		new pixi.Text( { text: value, style: { fill, fontSize: size, fontFamily: FONT_FAMILY, fontWeight: weight }, resolution: CHIP_TEXT_RES } );
	const hashText = text( '#', palette.accent, fontSize, '700' );
	const nameText = text( truncate( term.name, CHIP_NAME_MAX_CHARS ), palette.fg, fontSize, '600' );
	const countText = text( String( term.count ), palette.fg, Math.max( 10, Math.round( fontSize * 0.55 ) ), '700' );
	for ( const child of [ shadow, bg, hashText, nameText, countText ] ) {
		container.addChild( child );
	}
	layer.addChild( container );
	return { container, shadow, bg, hashText, nameText, countText, cachedHover: false };
}

export function layoutTagChip( box: TagBox, focused: boolean, palette: CanvasPalette ): void {
	const chip = box.chip;
	const displayName = truncate( box.name, CHIP_NAME_MAX_CHARS );
	const countStr = String( box.count );
	if ( chip.nameText.text !== displayName ) {
		chip.nameText.text = displayName;
	}
	if ( chip.countText.text !== countStr ) {
		chip.countText.text = countStr;
	}
	chip.nameText.style.fontSize = box.fontSize;
	chip.hashText.style.fontSize = box.fontSize;
	chip.countText.style.fontSize = Math.max( 10, Math.round( box.fontSize * 0.55 ) );
	const nameH = chip.nameText.height;
	const countBadgeW = Math.max( 18, chip.countText.width + 10 );
	const countBadgeH = Math.max( 14, chip.countText.height + 4 );
	box.width = CHIP_PAD_X + chip.hashText.width + CHIP_GAP_HASH + chip.nameText.width + CHIP_GAP_COUNT + countBadgeW + CHIP_PAD_X;
	box.height = Math.max( nameH, countBadgeH ) + CHIP_PAD_Y * 2;
	paintTagChip( box, focused, palette );
}

export function paintTagChip( box: TagBox, focused: boolean, palette: CanvasPalette ): void {
	const chip = box.chip;
	const totalW = box.width;
	const totalH = box.height;
	const left = -totalW / 2;
	const top = -totalH / 2;
	const radius = totalH / 2;
	const fillBg = focused || chip.cachedHover ? palette.raised : palette.surface;
	const borderColor = focused ? palette.accent : palette.border;
	const countBg = tagTone( box.hue );

	chip.shadow.clear();
	chip.shadow.roundRect( left - 1, top + 3, totalW + 2, totalH + 2, radius + 1 );
	let shadowAlpha = 0.1;
	if ( focused ) {
		shadowAlpha = 0.18;
	} else if ( chip.cachedHover ) {
		shadowAlpha = 0.16;
	}
	chip.shadow.fill( { color: 0x000000, alpha: shadowAlpha } );
	chip.bg.clear();
	chip.bg.roundRect( left, top, totalW, totalH, radius );
	chip.bg.fill( fillBg );
	chip.bg.stroke( { color: borderColor, width: focused ? 2 : 1.25, alpha: focused ? 1 : 0.85 } );

	const hashW = chip.hashText.width;
	const nameW = chip.nameText.width;
	const nameH = chip.nameText.height;
	const countW = chip.countText.width;
	const countH = chip.countText.height;
	const countBadgeW = Math.max( 18, countW + 10 );
	const countBadgeH = Math.max( 14, countH + 4 );
	chip.hashText.x = left + CHIP_PAD_X;
	chip.hashText.y = ( totalH - nameH ) / 2 + top;
	chip.hashText.style.fill = palette.accent;
	chip.nameText.x = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH;
	chip.nameText.y = ( totalH - nameH ) / 2 + top;
	chip.nameText.style.fill = palette.fg;
	const badgeX = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH + nameW + CHIP_GAP_COUNT;
	const badgeY = ( totalH - countBadgeH ) / 2 + top;

	chip.bg.roundRect( badgeX, badgeY, countBadgeW, countBadgeH, countBadgeH / 2 );
	chip.bg.fill( countBg );
	chip.countText.x = badgeX + ( countBadgeW - countW ) / 2;
	chip.countText.y = badgeY + ( countBadgeH - countH ) / 2;
	chip.countText.style.fill = badgeInk( countBg, palette );
}
