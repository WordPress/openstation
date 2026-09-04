/**
 * Posts app — the Categories mind map's name + count chips: in-world,
 * counter-scaled so their on-screen size is constant at any zoom,
 * relaid out only when the facts they show diverge from the node.
 *
 * @public
 */

import { stopBubble, type Interaction } from './canvas/camera';
import { CHIP_TEXT_RES, FONT_FAMILY, truncate, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiText } from './canvas/pixi';
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
	/** Repaint a node's chip from its current facts. */
	relayout( node: MindNode ): void;
	destroy( id: number ): void;
	/**
	 * Per frame: prune dead chips, position the live ones, dim the
	 * unfocused branches while a node is deployed, and relayout any
	 * chip whose cached facts diverged from its node.
	 */
	sync( nodes: Map< number, MindNode >, counterScale: number, focusId: number | null ): void;
}

export function createChipStore(
	pixi: PixiNamespace,
	layer: PixiContainer,
	interaction: Interaction,
	opts: { isFocused: ( id: number ) => boolean; onTap: ( id: number ) => void },
): ChipStore {
	const chips = new Map< number, CategoryChip >();

	function layout( chip: CategoryChip, node: MindNode ): void {
		const focused = opts.isFocused( node.id );
		const displayName = truncate( node.name, CHIP_NAME_MAX_CHARS );
		const countStr = String( node.count );
		// Pixi.Text re-rasterises on assignment — only when changed.
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
		// Anchor: top-centre at the container origin, placed at the
		// disc's bottom-centre.
		const left = -totalW / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, 0, totalW, totalH, totalH / 2 );
		if ( focused ) {
			chip.bg.fill( node.color );
		} else if ( chip.cachedHover ) {
			chip.bg.fill( { color: 0xffffff, alpha: 0.96 } );
			chip.bg.stroke( { color: node.color, width: 1.5, alpha: 1 } );
		} else {
			chip.bg.fill( { color: 0xffffff, alpha: 0.88 } );
			chip.bg.stroke( { color: 0x000000, width: 1, alpha: 0.06 } );
		}
		chip.nameText.x = left + padX;
		chip.nameText.y = ( totalH - nameH ) / 2;
		chip.nameText.style.fill = focused ? 0xffffff : 0x1d2327;
		const badgeX = left + padX + nameW + gap;
		const badgeY = ( totalH - badgeH ) / 2;
		chip.countBg.clear();
		chip.countBg.roundRect( badgeX, badgeY, badgeW, badgeH, badgeH / 2 );
		chip.countBg.fill( focused ? { color: 0xffffff, alpha: 0.25 } : node.color );
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
			style: { fill: 0x1d2327, fontSize: 14, fontFamily: FONT_FAMILY, fontWeight: '600' },
			resolution: CHIP_TEXT_RES,
		} );
		const countBg = new pixi.Graphics();
		const countText = new pixi.Text( {
			text: String( node.count ),
			style: { fill: 0xffffff, fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: '700' },
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
		container.on( 'pointertap', () => opts.onTap( node.id ) );
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
