/**
 * Posts app — the Tags cloud's hashtag pills: the chip's Pixi parts,
 * the measure for its intrinsic font size (the size IS the reading —
 * most-used tags look biggest), and the paint (a paper sticker with a
 * soft drop shadow, the per-slug hue, a count badge).
 *
 * @public
 */

import { CHIP_TEXT_RES, FONT_FAMILY, hslToInt, truncate, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiText } from './canvas/pixi';
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

/** The focused fill of a tag — also the tone of its post fan. */
export const tagTone = ( hue: number ): number => hslToInt( hue, 70, 48 );

export function createTagChip( pixi: PixiNamespace, layer: PixiContainer, term: TermRow, fontSize: number, hue: number ): TagChip {
	const container = new pixi.Container();
	container.eventMode = 'static';
	container.cursor = 'pointer';
	const shadow = new pixi.Graphics();
	const bg = new pixi.Graphics();
	const text = ( value: string, fill: number, size: number, weight: string ): PixiText =>
		new pixi.Text( { text: value, style: { fill, fontSize: size, fontFamily: FONT_FAMILY, fontWeight: weight }, resolution: CHIP_TEXT_RES } );
	const hashText = text( '#', hslToInt( hue, 65, 42 ), fontSize, '700' );
	const nameText = text( truncate( term.name, CHIP_NAME_MAX_CHARS ), 0x1d2327, fontSize, '600' );
	const countText = text( String( term.count ), 0xffffff, Math.max( 10, Math.round( fontSize * 0.55 ) ), '700' );
	for ( const child of [ shadow, bg, hashText, nameText, countText ] ) {
		container.addChild( child );
	}
	layer.addChild( container );
	return { container, shadow, bg, hashText, nameText, countText, cachedHover: false };
}

/** Measure the chip for its intrinsic font size, then paint it. */
export function layoutTagChip( box: TagBox, focused: boolean ): void {
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
	paintTagChip( box, focused );
}

export function paintTagChip( box: TagBox, focused: boolean ): void {
	const chip = box.chip;
	const totalW = box.width;
	const totalH = box.height;
	const left = -totalW / 2;
	const top = -totalH / 2;
	const radius = totalH / 2;
	let fillBg: number;
	if ( focused ) {
		fillBg = tagTone( box.hue );
	} else if ( chip.cachedHover ) {
		fillBg = hslToInt( box.hue, 70, 92 );
	} else {
		fillBg = hslToInt( box.hue, 60, 95 );
	}
	const borderColor = focused ? hslToInt( box.hue, 70, 38 ) : hslToInt( box.hue, 50, 70 );
	const countBg = focused ? hslToInt( box.hue, 80, 30 ) : hslToInt( box.hue, 70, 50 );

	// A soft drop shadow — paper stickers pinned to a corkboard.
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
	chip.hashText.style.fill = focused ? 0xffffff : hslToInt( box.hue, 65, 42 );
	chip.nameText.x = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH;
	chip.nameText.y = ( totalH - nameH ) / 2 + top;
	chip.nameText.style.fill = focused ? 0xffffff : 0x1d2327;
	const badgeX = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH + nameW + CHIP_GAP_COUNT;
	const badgeY = ( totalH - countBadgeH ) / 2 + top;
	// The count badge is a second roundRect on bg with its own fill.
	chip.bg.roundRect( badgeX, badgeY, countBadgeW, countBadgeH, countBadgeH / 2 );
	chip.bg.fill( countBg );
	chip.countText.x = badgeX + ( countBadgeW - countW ) / 2;
	chip.countText.y = badgeY + ( countBadgeH - countH ) / 2;
	chip.countText.style.fill = 0xffffff;
}
