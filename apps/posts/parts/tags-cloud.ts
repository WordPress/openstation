import { __ } from '@openstation/app';
import type { CanvasEnv } from './app';
import { isPinchGesture, pointerTravel, stopBubble, type Bounds } from './canvas/camera';
import { CHIP_TEXT_RES, readAdminThemeHue, type PixiPoint, type PixiPointerEvent } from './canvas/pixi';
import { createTermCanvas, type TermCanvas } from './canvas/term-canvas';
import { createTagChip, layoutTagChip, paintTagChip, tagTone, type TagBox } from './cloud-chips';
import {
	computePositionsKey,
	fontSizeFor,
	packBoxesWithClusters,
	readPersistedPositions,
	tagHue,
	tagRotation,
	writePersistedPositions,
	type Aabb,
} from './cloud-layout';
import { paintSidebar, type CloudSidebarHost } from './cloud-sidebar';
import type { TermNeighbor } from './types';

export async function mountTagsCloud( host: HTMLElement, env: CanvasEnv ): Promise< () => void > {
	const built = await createTermCanvas( host, env, {
		taxonomy: 'tags',
		restTaxonomy: 'post_tag',
		modifier: 'os-tagcloud',
		unavailable: __( 'Tag cloud unavailable.' ),
		loadFailed: __( 'Couldn’t load tags:' ),
		emptyHint: __( 'No tags yet. Click "Add tag" to start building the cloud.' ),
		chrome: {
			buttons: [
				{ variant: 'primary', icon: 'dashicons-plus', label: __( 'Add tag' ) },
				{ icon: 'dashicons-image-rotate', label: __( 'Recenter' ) },
				{
					icon: 'dashicons-grid-view',
					label: __( 'Reflow' ),
					title: __( 'Recompute the chip layout from scratch — discards manual repositioning.' ),
				},
			],
			searchPlaceholder: __( 'Search tags…' ),
			searchAria: __( 'Search tags in the cloud' ),
			hint: __( 'Click a tag to focus + edit · drag to reposition · scroll or pinch to zoom' ),
		},

		layers: [ 'postEdge', 'chip', 'post', 'postChip' ],
		fan: { chipFontSize: 12, chipTextRes: CHIP_TEXT_RES, pagerLabelSize: 12, pagerGlyphSize: 14 },
	} );
	if ( ! built ) {
		return () => {};
	}

	const canvas: TermCanvas = built;
	const { pixi, layers, fan, camera, interaction, world, palette } = canvas;
	const { client } = env;

	const tags = new Map< number, TagBox >();
	let dragChip: TagBox | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };
	let dragStart: PixiPoint | null = null;
	let dragOrigin: PixiPoint | null = null;
	let draft = false;
	const positionsKey = computePositionsKey();
	const persistedPositions = readPersistedPositions( positionsKey );

	let cooccurrenceMap: Map< number, TermNeighbor[] > = new Map();
	let themeHue = readAdminThemeHue( host );
	const focused = ( id: number ): boolean => fan.focusId === id;
	const layoutChip = ( box: TagBox ): void => layoutTagChip( box, focused( box.id ), palette );
	const paintChip = ( box: TagBox ): void => paintTagChip( box, focused( box.id ), palette );

	function buildCloud(): void {
		const terms = canvas.terms;
		const liveIds = new Set( terms.map( ( t ) => t.id ) );
		for ( const [ id, box ] of tags ) {
			if ( ! liveIds.has( id ) ) {
				layers.chip.removeChild( box.chip.container );
				box.chip.container.destroy( { children: true } );
				tags.delete( id );
			}
		}

		const maxCount = Math.max( 1, ...terms.map( ( t ) => t.count ) );

		const fresh: TagBox[] = [];
		for ( const term of terms ) {
			const fontSize = fontSizeFor( term.count, maxCount );
			const hue = tagHue( term.slug || term.name, themeHue );
			const rotation = tagRotation( term.slug || term.name );
			const existing = tags.get( term.id );
			if ( existing ) {
				existing.name = term.name;
				existing.slug = term.slug;
				existing.description = term.description;
				existing.count = term.count;
				existing.fontSize = fontSize;
				existing.hue = hue;
				existing.rotation = rotation;
				layoutChip( existing );
				continue;
			}
			const persisted = persistedPositions.get( term.id );
			const box: TagBox = {
				id: term.id,
				name: term.name,
				slug: term.slug,
				description: term.description,
				count: term.count,
				fontSize,
				hue,
				rotation,
				x: persisted?.x ?? 0,
				y: persisted?.y ?? 0,
				tx: persisted?.x ?? 0,
				ty: persisted?.y ?? 0,
				width: 0,
				height: 0,
				chip: createTagChip( pixi, layers.chip, term, fontSize, palette ),
			};
			tags.set( term.id, box );
			layoutChip( box );
			wireChipPointer( box );
			if ( ! persisted ) {
				fresh.push( box );
			}
		}
		const placed: Aabb[] = [];
		const placedById = new Map< number, { x: number; y: number } >();
		for ( const box of tags.values() ) {
			if ( ! fresh.includes( box ) ) {
				placed.push( { x: box.tx - box.width / 2, y: box.ty - box.height / 2, w: box.width, h: box.height } );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			}
		}
		fresh.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( fresh, placed, placedById, cooccurrenceMap );
		for ( const box of fresh ) {
			box.x = box.tx;
			box.y = box.ty;
		}

		canvas.syncEmptyHint( terms.length === 0 );
	}

	function wireChipPointer( box: TagBox ): void {
		const c = box.chip.container;
		c.on( 'pointerdown', ( e ) => {
			if ( isPinchGesture( interaction ) ) {
				return;
			}
			const ev = e as PixiPointerEvent;
			stopBubble( interaction, e );
			dragChip = box;
			dragOrigin = { x: box.tx, y: box.ty };
			dragStart = { x: ev.global.x, y: ev.global.y };
			const local = camera.stageToWorld( ev.global );
			dragOffset = { x: box.x - local.x, y: box.y - local.y };
		} );
		c.on( 'pointerover', () => {
			box.chip.cachedHover = true;
			paintChip( box );
		} );
		c.on( 'pointerout', () => {
			box.chip.cachedHover = false;
			paintChip( box );
		} );
	}

	function drift( dt: number ): void {
		const nudge = canvas.nudge;
		for ( const box of tags.values() ) {
			if ( box === dragChip ) {
				continue;
			}
			let tx = box.tx;
			let ty = box.ty;
			if ( nudge && box.id !== fan.focusId ) {
				const dx = box.tx - nudge.x;
				const dy = box.ty - nudge.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				const limit = nudge.radius + Math.max( box.width, box.height ) / 2;
				if ( d < limit ) {
					const push = limit + 12;
					tx = nudge.x + ( dx / d ) * push;
					ty = nudge.y + ( dy / d ) * push;
				}
			}
			const ease = 1 - Math.exp( -dt * 0.012 );
			box.x += ( tx - box.x ) * ease;
			box.y += ( ty - box.y ) * ease;
		}
	}

	function syncChipPositions(): void {
		const chipCounterScale = 1 / Math.max( 0.01, world.scale.x );
		const anyFocus = fan.focusId !== null;
		for ( const box of tags.values() ) {
			const c = box.chip.container;
			c.x = box.x;
			c.y = box.y;

			c.scale.set( 1 );
			c.rotation = box.rotation;
			const targetAlpha = ! anyFocus || fan.focusId === box.id ? 1 : 0.32;
			if ( Math.abs( c.alpha - targetAlpha ) > 0.005 ) {
				c.alpha += ( targetAlpha - c.alpha ) * 0.18;
			} else {
				c.alpha = targetAlpha;
			}
		}
		fan.syncChips( chipCounterScale );
	}

	function dragEnd( ev?: PixiPointerEvent ): void {
		if ( ! dragChip ) {
			return;
		}
		const box = dragChip;
		const movement = pointerTravel( dragStart, ev );
		dragChip = null;
		dragStart = null;
		if ( movement < 3 ) {
			void canvas.focusOn( box.id );
		} else {
			persistedPositions.set( box.id, { x: box.tx, y: box.ty } );
			writePersistedPositions( positionsKey, persistedPositions );
		}
	}

	const sidebarHost: CloudSidebarHost = {
		sidebar: canvas.sidebar,
		client,
		toast: env.toast,
		themeHue,
		terms: () => canvas.terms,
		setTerms: ( next ) => {
			canvas.terms = next;
		},
		tag: ( id ) => tags.get( id ),
		focusId: () => fan.focusId,
		setFocus: ( id ) => {
			fan.focusId = id;
		},
		draft: () => draft,
		setDraft: ( on ) => {
			draft = on;
		},
		applyTagUpdate: ( id, patch ) => {
			const box = tags.get( id );
			if ( ! box ) {
				return;
			}
			box.name = patch.name;
			box.description = patch.description;
			box.slug = patch.slug;

			box.hue = tagHue( box.slug || box.name, themeHue );
			box.rotation = tagRotation( box.slug || box.name );
			layoutChip( box );
		},
		forgetTag: ( id ) => {
			persistedPositions.delete( id );
			writePersistedPositions( positionsKey, persistedPositions );
		},
		buildCloud,
		clearPosts: () => fan.clear(),
		loadPosts: () => fan.load(),
	};

	function cloudBounds(): Bounds | null {
		if ( tags.size === 0 ) {
			return null;
		}
		const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for ( const box of tags.values() ) {
			b.minX = Math.min( b.minX, box.tx - box.width / 2 );
			b.minY = Math.min( b.minY, box.ty - box.height / 2 );
			b.maxX = Math.max( b.maxX, box.tx + box.width / 2 );
			b.maxY = Math.max( b.maxY, box.ty + box.height / 2 );
		}
		return b;
	}

	function relayoutWithCooccurrence(): void {
		const placed: Aabb[] = [];
		const placedById = new Map< number, { x: number; y: number } >();
		const toRepack: TagBox[] = [];
		for ( const box of tags.values() ) {
			if ( persistedPositions.has( box.id ) ) {
				placed.push( { x: box.tx - box.width / 2, y: box.ty - box.height / 2, w: box.width, h: box.height } );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			} else {
				toRepack.push( box );
			}
		}
		toRepack.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( toRepack, placed, placedById, cooccurrenceMap );
	}

	async function refreshCooccurrence(): Promise< void > {
		try {
			cooccurrenceMap = await client.fetchTagCooccurrence( 'tags', 8 );
			if ( cooccurrenceMap.size > 0 ) {
				relayoutWithCooccurrence();
			}
		} catch {

		}
	}

	const [ addTagBtn, recenterBtn, reflowBtn ] = canvas.chrome.buttons;
	recenterBtn.addEventListener( 'click', () => canvas.recenter() );
	addTagBtn.addEventListener( 'click', () => {
		draft = true;
		paintSidebar( sidebarHost );
	} );
	reflowBtn.addEventListener( 'click', () => {
		persistedPositions.clear();
		writePersistedPositions( positionsKey, persistedPositions );
		for ( const box of tags.values() ) {
			box.tx = 0;
			box.ty = 0;
		}
		const allBoxes = Array.from( tags.values() ).sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( allBoxes, [], new Map(), cooccurrenceMap );
		camera.fitToView( cloudBounds(), { animate: true } );
		void refreshCooccurrence();
	} );

	buildCloud();
	paintSidebar( sidebarHost );
	canvas.start( {
		themeChanged: () => {
			themeHue = readAdminThemeHue( host );
			for ( const box of tags.values() ) {
				box.hue = tagHue( box.slug || box.name, themeHue );
				paintChip( box );
			}
		},
		center: ( id ) => {
			const box = tags.get( id );
			return box ? { x: box.x, y: box.y, tone: tagTone( box.hue ) } : null;
		},
		countReconciled: ( id, total ) => {
			const box = tags.get( id );
			if ( box && box.count !== total ) {
				box.count = total;
				canvas.terms = canvas.terms.map( ( t ) => ( t.id === id ? { ...t, count: total } : t ) );
				layoutChip( box );
			}
		},
		focusChanged: () => {
			for ( const box of tags.values() ) {
				paintChip( box );
			}
			paintSidebar( sidebarHost );
		},
		bounds: cloudBounds,
		frame: ( dt ) => {
			drift( dt );
			fan.ease();
			fan.drawEdges();
			syncChipPositions();
		},
		countsChanged: () => {
			const maxCount = Math.max( 1, ...canvas.terms.map( ( t ) => t.count ) );
			for ( const t of canvas.terms ) {
				const box = tags.get( t.id );
				if ( box ) {
					box.count = t.count;
					box.fontSize = fontSizeFor( t.count, maxCount );
					layoutChip( box );
				}
			}
			if ( fan.focusId !== null ) {
				paintSidebar( sidebarHost );
			}
		},
		dragging: () => dragChip !== null,
		pointerMove: ( _ev, cursorWorld ) => {
			if ( ! dragChip ) {
				return false;
			}
			dragChip.x = cursorWorld.x + dragOffset.x;
			dragChip.y = cursorWorld.y + dragOffset.y;
			dragChip.tx = dragChip.x;
			dragChip.ty = dragChip.y;
			return true;
		},
		pointerUp: dragEnd,
		cancelGesture: () => {
			if ( dragChip && dragOrigin ) {
				dragChip.x = dragChip.tx = dragOrigin.x;
				dragChip.y = dragChip.ty = dragOrigin.y;
			}
			dragChip = null; dragStart = null; dragOrigin = null;
		},
		search: ( q ) => Array.from( tags.values() ).filter( ( t ) => t.name.toLowerCase().includes( q ) || t.slug.toLowerCase().includes( q ) ),
	} );
	void refreshCooccurrence();

	return () => canvas.teardown();
}
