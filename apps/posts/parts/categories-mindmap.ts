import { __ } from '@openstation/app';
import type { CanvasEnv } from './app';
import { isPinchGesture, pointerTravel, stopBubble, type Bounds } from './canvas/camera';
import { CHIP_TEXT_RES, hslToInt, readAdminThemeHue, type PixiPoint, type PixiPointerEvent } from './canvas/pixi';
import { SPOTLIGHT_RADIUS, createTermCanvas, type TermCanvas } from './canvas/term-canvas';
import { createChipStore } from './mindmap-chips';
import { bezierAt, drawCurvedEdge, drawDropTarget, drawNodeDisc, type MindNode } from './mindmap-draw';
import { physicsStep, preSettle } from './mindmap-physics';
import { paintSidebar, type MindmapSidebarHost } from './mindmap-sidebar';
import type { TermRow } from './types';

const MIN_RADIUS = 22;
const MAX_RADIUS = 48;

function nodeRadius( count: number, all: TermRow[] ): number {
	const max = Math.max( 1, ...all.map( ( t ) => t.count ) );
	return MIN_RADIUS + ( MAX_RADIUS - MIN_RADIUS ) * Math.sqrt( count / max );
}

function isUncategorized( term: TermRow ): boolean {
	return term.isDefault || term.id === 1 || term.slug === 'uncategorized' || term.name.toLowerCase() === 'uncategorized';
}

export async function mountCategoriesMindmap( host: HTMLElement, env: CanvasEnv ): Promise< () => void > {
	const built = await createTermCanvas( host, env, {
		taxonomy: 'categories',
		restTaxonomy: 'category',
		modifier: 'os-mindmap',
		unavailable: __( 'Mindmap unavailable.' ),
		loadFailed: __( 'Couldn’t load categories:' ),
		emptyHint: __( 'No custom categories yet. Click "Add root category" to start branching.' ),
		chrome: {
			buttons: [
				{ variant: 'primary', icon: 'dashicons-plus', label: __( 'Add root category' ) },
				{ icon: 'dashicons-image-rotate', label: __( 'Recenter' ) },
			],
			searchPlaceholder: __( 'Search categories…' ),
			searchAria: __( 'Search categories in the mindmap' ),
			hint: __( 'Click a node to focus + edit · drag onto another to reparent · scroll or pinch to zoom' ),
		},

		layers: [ 'edge', 'postEdge', 'post', 'node', 'chip', 'postChip' ],
		fan: { chipFontSize: 14, chipTextRes: CHIP_TEXT_RES, pagerLabelSize: 14, pagerGlyphSize: 16, pagerTextRes: CHIP_TEXT_RES },
	} );
	if ( ! built ) {
		return () => {};
	}

	const canvas: TermCanvas = built;
	const { pixi, layers, fan, camera, interaction, world, palette } = canvas;
	const { client } = env;
	const edgeGfx = new pixi.Graphics();
	layers.edge.addChild( edgeGfx );

	const nodes = new Map< number, MindNode >();
	const chips = createChipStore( pixi, layers.chip, interaction, {
		palette,
		isFocused: ( id ) => fan.focusId === id,
		onTap: ( id ) => void canvas.focusOn( id ),
	} );
	let dragNode: MindNode | null = null;
	let dragHover: MindNode | null = null;
	let dragStartPos: PixiPoint | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };

	const pinnedTargetBackup = new Map< number, { tx: number; ty: number } >();
	let draft: { parent: number } | null = null;
	let themeHue = readAdminThemeHue( host );
	const clusterColor = ( idx: number ): number => hslToInt( ( themeHue + idx * 47 ) % 360, 55, 52 );

	function upsertNode( term: TermRow, facts: { tx: number; ty: number; radius: number; depth: number; color: number; pinned: boolean } ): MindNode {
		let node = nodes.get( term.id );
		if ( ! node ) {
			const gfx = new pixi.Graphics();
			gfx.eventMode = 'static';
			gfx.cursor = 'pointer';
			node = {
				id: term.id,
				parent: term.parent,
				name: term.name,
				description: term.description,
				count: term.count,
				x: facts.tx,
				y: facts.ty,
				tx: facts.tx,
				ty: facts.ty,
				radius: facts.radius,
				depth: facts.depth,
				color: facts.color,
				gfx,
				pinned: facts.pinned,
			};
			layers.node.addChild( gfx );

			const created = node;
			gfx.on( 'pointerdown', ( e ) => onNodePointerDown( e as PixiPointerEvent, created ) );
			nodes.set( term.id, node );
		} else {
			node.parent = term.parent;
			node.name = term.name;
			node.description = term.description;
			node.count = term.count;
			node.depth = facts.depth;
			node.color = facts.color;
			node.radius = facts.radius;
			node.tx = facts.tx;
			node.ty = facts.ty;
			node.pinned = facts.pinned;
		}
		drawNodeDisc( pixi, node, false, palette );
		return node;
	}

	function buildTree(): void {
		const terms = canvas.terms;
		const childMap = new Map< number, TermRow[] >();
		for ( const t of terms ) {
			const list = childMap.get( t.parent ) ?? [];
			list.push( t );
			childMap.set( t.parent, list );
		}

		const allRoots = childMap.get( 0 ) ?? [];
		const roots = allRoots.filter( ( r ) => ! isUncategorized( r ) );
		const uncategorized = allRoots.find( isUncategorized );

		const place = ( term: TermRow, depth: number, rootIdx: number, angle: number, angleSpan: number ): void => {
			const rootRingByCount = roots.length > 1 ? 110 + roots.length * 28 : 0;
			const rootRing = uncategorized ? Math.max( rootRingByCount, 140 ) : rootRingByCount;
			const baseRadius = depth === 0 ? rootRing : rootRing + 160 + ( depth - 1 ) * 150;
			const color = depth === 0 ? clusterColor( rootIdx ) : nodes.get( term.parent )?.color ?? clusterColor( rootIdx );
			upsertNode( term, {
				tx: baseRadius * Math.cos( angle ),
				ty: baseRadius * Math.sin( angle ),
				radius: nodeRadius( term.count, terms ),
				depth,
				color,
				pinned: depth === 0,
			} );
			const kids = childMap.get( term.id ) ?? [];
			if ( kids.length > 0 ) {
				const sub = angleSpan / kids.length;
				kids.forEach( ( child, i ) => place( child, depth + 1, rootIdx, angle - angleSpan / 2 + sub * ( i + 0.5 ), sub * 0.85 ) );
			}
		};

		const liveIds = new Set( terms.map( ( t ) => t.id ) );
		for ( const [ id, node ] of nodes ) {
			if ( ! liveIds.has( id ) ) {
				layers.node.removeChild( node.gfx );
				node.gfx.destroy();
				nodes.delete( id );
				chips.destroy( id );
			}
		}
		const rootCount = Math.max( 1, roots.length );
		roots.forEach( ( root, idx ) => place( root, 0, idx, ( ( 2 * Math.PI ) / rootCount ) * idx, ( 2 * Math.PI ) / rootCount ) );
		if ( uncategorized ) {
			upsertNode( uncategorized, { tx: 0, ty: 0, radius: nodeRadius( uncategorized.count, terms ), depth: 0, color: 0x8c8f94, pinned: true } );
		}

		canvas.syncEmptyHint( terms.length <= 1 );
	}

	function drawEdges(): void {
		edgeGfx.clear();
		for ( const node of nodes.values() ) {
			const parent = node.parent ? nodes.get( node.parent ) : undefined;
			if ( ! parent ) {
				continue;
			}

			const isOldLink = dragNode !== null && node === dragNode;
			const isFocusEdge = fan.focusId !== null && ( node.id === fan.focusId || node.parent === fan.focusId );
			const dimMul = fan.focusId !== null && ! isFocusEdge ? 0.35 : 1;
			drawCurvedEdge( edgeGfx, parent.x, parent.y, node.x, node.y, parent.color, isOldLink ? { dashed: true, alpha: 0.28 * dimMul } : { alpha: 0.5 * dimMul } );
		}

		if ( dragNode && dragHover ) {
			const { x: x1, y: y1 } = dragNode;
			const { x: x2, y: y2, color: targetColor } = dragHover;
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, { alpha: 0.22, width: 9 } );
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, {
				alpha: 0.95,
				width: 2.5,
				dashed: true,
				dashStride: 2,
				dashPhase: Math.floor( performance.now() / 70 ),
			} );
			const pt = ( performance.now() % 1300 ) / 1300;
			const dx = x2 - x1;
			const p = bezierAt( pt, x1, y1, x1 + dx * 0.5, y1, x2 - dx * 0.5, y2, x2, y2 );
			edgeGfx.circle( p.x, p.y, 5 );
			edgeGfx.fill( { color: 0xffffff, alpha: 0.95 } );
			edgeGfx.stroke( { color: targetColor, width: 2, alpha: 1 } );
		}
		fan.drawEdges();
	}

	function onNodePointerDown( ev: PixiPointerEvent, node: MindNode ): void {
		if ( isPinchGesture( interaction ) ) {
			return;
		}
		stopBubble( interaction, ev );
		dragNode = node;
		node.pinned = true;
		node.tx = node.x;
		node.ty = node.y;
		dragStartPos = { x: ev.global.x, y: ev.global.y };

		const local = camera.stageToWorld( ev.global );
		dragOffset = { x: node.x - local.x, y: node.y - local.y };
	}

	function isAncestor( ancestor: number, descendant: number ): boolean {
		let cur = nodes.get( descendant );
		let safety = 32;
		while ( cur && safety-- > 0 ) {
			if ( cur.id === ancestor ) {
				return true;
			}
			if ( ! cur.parent ) {
				return false;
			}
			cur = nodes.get( cur.parent );
		}
		return false;
	}

	function dragMove( cursorWorld: PixiPoint ): void {
		if ( ! dragNode ) {
			return;
		}
		const nx = cursorWorld.x + dragOffset.x;
		const ny = cursorWorld.y + dragOffset.y;
		dragNode.x = nx;
		dragNode.y = ny;
		dragNode.tx = nx;
		dragNode.ty = ny;
		dragNode.gfx.x = nx;
		dragNode.gfx.y = ny;

		let hover: MindNode | null = null;
		for ( const c of nodes.values() ) {
			if ( c === dragNode ) {
				continue;
			}
			const dx = c.x - cursorWorld.x;
			const dy = c.y - cursorWorld.y;
			if ( dx * dx + dy * dy < c.radius * c.radius ) {
				hover = c;
				break;
			}
		}
		if ( hover !== dragHover ) {
			if ( dragHover ) {
				drawNodeDisc( pixi, dragHover, fan.focusId === dragHover.id, palette );
			}
			dragHover = hover;
			if ( hover ) {
				drawDropTarget( pixi, hover, dragNode.color, palette );
			}
		}
	}

	async function dragEnd( ev?: PixiPointerEvent ): Promise< void > {
		if ( ! dragNode ) {
			return;
		}
		const node = dragNode;
		const target = dragHover;
		const movement = pointerTravel( dragStartPos, ev );
		dragNode = null;
		dragHover = null;
		dragStartPos = null;
		node.pinned = node.depth === 0;

		if ( ! target && movement < 2 ) {
			void canvas.focusOn( node.id );
			return;
		}

		if ( target && target.id !== node.parent && ! isAncestor( node.id, target.id ) ) {
			try {
				await client.updateTerm( 'categories', node.id, { parent: target.id } );
				node.parent = target.id;
				canvas.terms = canvas.terms.map( ( t ) => ( t.id === node.id ? { ...t, parent: target.id } : t ) );
				buildTree();
			} catch ( err ) {
				env.toast( __( 'Reparent failed:' ), err );
			}
		} else {
			drawNodeDisc( pixi, node, fan.focusId === node.id, palette );
			if ( target ) {
				drawNodeDisc( pixi, target, fan.focusId === target.id, palette );
			}
		}
	}

	const sidebarHost: MindmapSidebarHost = {
		sidebar: canvas.sidebar,
		client,
		toast: env.toast,
		terms: () => canvas.terms,
		setTerms: ( next ) => {
			canvas.terms = next;
		},
		node: ( id ) => nodes.get( id ),
		focusId: () => fan.focusId,
		setFocus: ( id ) => {
			fan.focusId = id;
		},
		draft: () => draft,
		setDraft: ( next ) => {
			draft = next && next.parent !== 0 && ! nodes.get( next.parent ) ? draft : next;
		},
		clusterColor,
		buildTree,
		relayoutNode: ( id ) => {
			const n = nodes.get( id );
			if ( n ) {
				chips.relayout( n );
			}
		},
		clearPosts: () => fan.clear(),
		loadPosts: () => fan.load(),
	};

	function treeBounds(): Bounds | null {
		if ( nodes.size === 0 ) {
			return null;
		}

		const LABEL_OVERHANG = 30;
		const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for ( const n of nodes.values() ) {
			b.minX = Math.min( b.minX, n.tx - n.radius );
			b.minY = Math.min( b.minY, n.ty - n.radius );
			b.maxX = Math.max( b.maxX, n.tx + n.radius );
			b.maxY = Math.max( b.maxY, n.ty + n.radius + LABEL_OVERHANG );
		}
		return b;
	}

	const [ addRootBtn, recenterBtn ] = canvas.chrome.buttons;
	recenterBtn.addEventListener( 'click', () => canvas.recenter() );
	addRootBtn.addEventListener( 'click', () => {
		draft = { parent: 0 };
		paintSidebar( sidebarHost );
	} );

	buildTree();
	paintSidebar( sidebarHost );
	preSettle( nodes, 80 );
	canvas.start( {
		themeChanged: () => {
			const nextHue = readAdminThemeHue( host );
			if ( nextHue !== themeHue ) {
				themeHue = nextHue;
				const roots = canvas.terms.filter( ( term ) => ! term.parent && ! isUncategorized( term ) );
				for ( const node of nodes.values() ) {
					let root = node;
					const seen = new Set< number >();
					while ( root.parent && nodes.has( root.parent ) && ! seen.has( root.id ) ) {
						seen.add( root.id ); root = nodes.get( root.parent )!;
					}
					const index = roots.findIndex( ( term ) => term.id === root.id );
					if ( index >= 0 ) {
						node.color = clusterColor( index );
					}
				}
			}
			for ( const node of nodes.values() ) {
				drawNodeDisc( pixi, node, fan.focusId === node.id, palette );
				chips.relayout( node );
			}
		},
		center: ( id ) => {
			const n = nodes.get( id );
			return n ? { x: n.x, y: n.y, tone: n.color } : null;
		},
		countReconciled: ( id, total ) => {
			const node = nodes.get( id );
			if ( node && node.count !== total ) {
				node.count = total;
				canvas.terms = canvas.terms.map( ( t ) => ( t.id === id ? { ...t, count: total } : t ) );
				chips.relayout( node );
			}
		},
		focusChanged: () => {
			for ( const n of nodes.values() ) {
				drawNodeDisc( pixi, n, fan.focusId === n.id, palette );
			}
			paintSidebar( sidebarHost );
		},
		focusOpened: ( center ) => {
			pinnedTargetBackup.clear();
			for ( const n of nodes.values() ) {
				if ( n.id === fan.focusId || ! n.pinned ) {
					continue;
				}
				const dx = n.x - center.x;
				const dy = n.y - center.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				if ( d >= SPOTLIGHT_RADIUS + n.radius ) {
					continue;
				}
				pinnedTargetBackup.set( n.id, { tx: n.tx, ty: n.ty } );
				const push = SPOTLIGHT_RADIUS + n.radius + 20;
				n.tx = center.x + ( dx / d ) * push;
				n.ty = center.y + ( dy / d ) * push;
			}
		},
		focusClosed: () => {
			for ( const [ id, t ] of pinnedTargetBackup ) {
				const n = nodes.get( id );
				if ( n ) {
					n.tx = t.tx;
					n.ty = t.ty;
				}
			}
			pinnedTargetBackup.clear();
		},
		bounds: treeBounds,
		frame: ( dt ) => {
			physicsStep( nodes, dt, { dragNode, focusId: fan.focusId, nudge: canvas.nudge } );
			fan.ease();
			drawEdges();
			if ( dragNode && dragHover ) {
				drawDropTarget( pixi, dragHover, dragNode.color, palette );
			}
			const counterScale = 1 / Math.max( 0.01, world.scale.x );
			chips.sync( nodes, counterScale, fan.focusId );
			fan.syncChips( counterScale );
		},
		countsChanged: () => {
			for ( const t of canvas.terms ) {
				const node = nodes.get( t.id );
				if ( node && node.count !== t.count ) {
					node.count = t.count;
					chips.relayout( node );
				}
			}
			buildTree();
			camera.fitToView( treeBounds(), { animate: true } );
		},
		dragging: () => dragNode !== null,
		pointerMove: ( _ev, cursorWorld ) => {
			if ( ! dragNode ) {
				return false;
			}
			dragMove( cursorWorld );
			return true;
		},
		pointerUp: dragEnd,
		cancelGesture: () => {
			if ( dragNode ) {
				dragNode.pinned = dragNode.depth === 0; drawNodeDisc( pixi, dragNode, fan.focusId === dragNode.id, palette );
			}
			if ( dragHover ) {
				drawNodeDisc( pixi, dragHover, fan.focusId === dragHover.id, palette );
			}
			dragNode = null; dragHover = null; dragStartPos = null;
		},
		search: ( q ) => Array.from( nodes.values() ).filter( ( n ) => n.name.toLowerCase().includes( q ) ),
	} );

	return () => canvas.teardown();
}
