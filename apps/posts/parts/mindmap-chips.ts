import { isPinchGesture, stopBubble, type Interaction } from './canvas/camera';
import { CHIP_TEXT_RES, FONT_FAMILY, truncate, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiText } from './canvas/pixi';
import { badgeInk, type CanvasPalette } from './canvas/palette';
import type { MindNode } from './mindmap-draw';

const CHIP_NAME_MAX_CHARS = 18;

interface CategoryChip {
	container: PixiContainer;
	bg: PixiGraphics;
	nameText: PixiText;
	countBg: PixiGraphics;
	countText: PixiText;
	cachedName: string;
	cachedCount: number;
	cachedFocused: boolean;
	cachedHover: boolean;
	cachedColor: number;
}

export interface ChipStore {

	relayout( node: MindNode ): void;
	destroy( id: number ): void;

	sync( nodes: Map< number, MindNode >, counterScale: number, focusId: number | null ): void;
}

export function createChipStore(
	pixi: PixiNamespace,
	layer: PixiContainer,
	interaction: Interaction,
	opts: { palette: CanvasPalette; isFocused: ( id: number ) => boolean; onTap: ( id: number ) => void },
): ChipStore {
	const chips = new Map< number, CategoryChip >();
	const palette = opts.palette;

	function layout( chip: CategoryChip, node: MindNode ): void {
		const focused = opts.isFocused( node.id );
		const displayName = truncate( node.name, CHIP_NAME_MAX_CHARS );
		const countStr = String( node.count );

		if ( chip.nameText.text !== displayName ) {
			chip.nameText.text = displayName;
		}
		if ( chip.countText.text !== countStr ) {
			chip.countText.text = countStr;
		}
		chip.cachedName = displayName;
		chip.cachedCount = node.count;
		chip.cachedFocused = focused;
		chip.cachedColor = node.color;

		const padX = 9;
		const padY = 3;
		const gap = 5;
		const countPadX = 5;
		const countPadY = 2;
		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const badgeW = Math.max( 18, countW + countPadX * 2 );
		const badgeH = countH + countPadY * 2;
		const totalW = padX + nameW + gap + badgeW + padX;
		const totalH = Math.max( nameH, badgeH ) + padY * 2;

		const left = -totalW / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, 0, totalW, totalH, totalH / 2 );
		if ( focused ) {
			chip.bg.fill( palette.raised );
			chip.bg.stroke( { color: node.color, width: 2 } );
		} else if ( chip.cachedHover ) {
			chip.bg.fill( { color: palette.raised, alpha: 1 } );
			chip.bg.stroke( { color: node.color, width: 1.5, alpha: 1 } );
		} else {
			chip.bg.fill( { color: palette.surface, alpha: 1 } );
			chip.bg.stroke( { color: palette.border, width: 1, alpha: 1 } );
		}
		chip.nameText.x = left + padX;
		chip.nameText.y = ( totalH - nameH ) / 2;
		chip.nameText.style.fill = palette.fg;
		const badgeX = left + padX + nameW + gap;
		const badgeY = ( totalH - badgeH ) / 2;
		chip.countBg.clear();
		chip.countBg.roundRect( badgeX, badgeY, badgeW, badgeH, badgeH / 2 );
		chip.countBg.fill( node.color );
		chip.countText.style.fill = badgeInk( node.color, palette );
		chip.countText.x = badgeX + ( badgeW - countW ) / 2;
		chip.countText.y = badgeY + ( badgeH - countH ) / 2;
	}

	function ensure( node: MindNode ): CategoryChip {
		const existing = chips.get( node.id );
		if ( existing ) {
			return existing;
		}
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'pointer';
		const bg = new pixi.Graphics();
		const nameText = new pixi.Text( {
			text: truncate( node.name, CHIP_NAME_MAX_CHARS ),
			style: { fill: palette.fg, fontSize: 14, fontFamily: FONT_FAMILY, fontWeight: '600' },
			resolution: CHIP_TEXT_RES,
		} );
		const countBg = new pixi.Graphics();
		const countText = new pixi.Text( {
			text: String( node.count ),
			style: { fill: palette.fg, fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: '700' },
			resolution: CHIP_TEXT_RES,
		} );
		container.addChild( bg );
		container.addChild( nameText );
		container.addChild( countBg );
		container.addChild( countText );
		const chip: CategoryChip = {
			container,
			bg,
			nameText,
			countBg,
			countText,
			cachedName: '',
			cachedCount: -1,
			cachedFocused: false,
			cachedHover: false,
			cachedColor: -1,
		};
		chips.set( node.id, chip );
		layer.addChild( container );
		container.on( 'pointerdown', ( e ) => stopBubble( interaction, e ) );
		container.on( 'pointertap', () => {
			if ( ! isPinchGesture( interaction ) ) {
				opts.onTap( node.id );
			}
		} );
		container.on( 'pointerover', () => {
			chip.cachedHover = true;
			layout( chip, node );
		} );
		container.on( 'pointerout', () => {
			chip.cachedHover = false;
			layout( chip, node );
		} );
		return chip;
	}

	const store: ChipStore = {
		relayout( node ) {
			layout( ensure( node ), node );
		},
		destroy( id ) {
			const chip = chips.get( id );
			if ( ! chip ) {
				return;
			}
			layer.removeChild( chip.container );
			chip.container.destroy( { children: true } );
			chips.delete( id );
		},
		sync( nodes, counterScale, focusId ) {
			for ( const id of [ ...chips.keys() ] ) {
				if ( ! nodes.has( id ) ) {
					store.destroy( id );
				}
			}
			const anyFocus = focusId !== null;
			for ( const node of nodes.values() ) {
				const chip = ensure( node );
				chip.container.x = node.x;
				chip.container.y = node.y + node.radius + 6;
				chip.container.scale.set( counterScale );
				const focused = focusId === node.id;
				const targetAlpha = ! anyFocus || focused ? 1 : 0.4;
				for ( const target of [ chip.container, node.gfx ] ) {
					if ( Math.abs( target.alpha - targetAlpha ) > 0.005 ) {
						target.alpha += ( targetAlpha - target.alpha ) * 0.18;
					} else {
						target.alpha = targetAlpha;
					}
				}
				if (
					chip.cachedName !== truncate( node.name, CHIP_NAME_MAX_CHARS ) ||
					chip.cachedCount !== node.count ||
					chip.cachedFocused !== focused ||
					chip.cachedColor !== node.color
				) {
					layout( chip, node );
				}
			}
		},
	};
	return store;
}
