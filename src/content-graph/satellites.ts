import { __, sprintf } from '../i18n';
import { resolveDashicon } from '../ui/components/os-icon/dashicons-map';
import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from './pixi-types';
import type { GraphNode, PostDetail } from './types';

export type SatelliteRef =
  | {
      kind: 'user';
      userId: number;
      label: string;
      meta: string;
      avatar?: string;
    }
  | {
      kind: 'term';
      termId: number;
      taxonomy: string;
      label: string;
      meta: string;
    }
  | {
      kind: 'comment';
      commentId: number;
      label: string;
      meta: string;
    }
  | {
      kind: 'media';
      mediaId: number;
      label: string;
      meta: string;
      thumb?: string;
    }
  | {
      kind: 'revision';
      revisionId: number;
      parentId: number;
      label: string;
      meta: string;
    };

export type SatelliteOnClick = ( ref: SatelliteRef ) => void;

export type PostTypeIconLookup = ( slug: string ) => string;

const KIND_COLOR: Record<SatelliteRef['kind'], number> = {
	user: 0x3a6df0,
	term: 0x2ca97a,
	comment: 0xe8893a,
	media: 0xa05ed4,
	revision: 0x6b7785,
};

const KIND_DASHICON: Record<SatelliteRef['kind'], string> = {
	user: 'admin-users',

	term: 'tag',
	comment: 'admin-comments',
	media: 'admin-media',
	revision: 'backup',
};

function iconForTermRef( ref: Extract< SatelliteRef, { kind: 'term' } > ): string {
	switch ( ref.taxonomy ) {
		case 'category':
			return 'category';
		case 'post_tag':
			return 'tag';
		default:
			return KIND_DASHICON.term;
	}
}

const KIND_ICON_NUDGE: Record<
	SatelliteRef[ 'kind' ],
	{ x: number; y: number }
> = {
	user: { x: 0, y: 3 },
	term: { x: 0, y: 3 },

	comment: { x: 1, y: 4 },
	media: { x: -1, y: 1 },
	revision: { x: 0, y: 3 },
};

const DISC_RADIUS = 14;

interface SatelliteView {
  ref: SatelliteRef;
  key: string;
  container: PixiContainer;
  disc: PixiGraphics;
  icon: PixiText;
  label: PixiText;
  targetX: number;
  targetY: number;
  selected: boolean;
}

export class SatelliteLayer {
	private linkGfx: PixiGraphics;
	private layer: PixiContainer;
	private views: SatelliteView[] = [];
	private focused: GraphNode | null = null;
	private hoverEl: HTMLDivElement;
	private rafId: number | null = null;
	private selectedKey: string | null = null;

	constructor(
    private pixi: PixiNamespace,

    private satelliteParent: PixiContainer,

    private spokeParent: PixiContainer,
    private onClick: SatelliteOnClick,
    private hostEl: HTMLElement,

    private claimPointer: () => void,
	) {
		this.linkGfx = new pixi.Graphics();
		this.spokeParent.addChild( this.linkGfx );

		this.layer = new pixi.Container();
		this.satelliteParent.addChild( this.layer );

		this.hoverEl = document.createElement( 'div' );
		this.hoverEl.className = 'os-content-graph__tooltip';
		this.hoverEl.hidden = true;
		this.hostEl.appendChild( this.hoverEl );
	}

	clear(): void {
		this.linkGfx.clear();
		this.layer.removeChildren();
		this.views = [];
		this.focused = null;
		this.selectedKey = null;
		this.hideTooltip();
	}

	drawLinks(): void {
		this.linkGfx.clear();
		if ( ! this.focused || this.views.length === 0 ) {
			return;
		}

		const halo = this.focused.radius + 8;
		const fx = this.focused.x;
		const fy = this.focused.y;
		for ( const v of this.views ) {
			const dx = v.container.x - fx;
			const dy = v.container.y - fy;
			const d = Math.sqrt( dx * dx + dy * dy );
			if ( d <= halo ) {
				continue;
			}
			const t = halo / d;
			const sx = fx + dx * t;
			const sy = fy + dy * t;
			const color = KIND_COLOR[ v.ref.kind ];
			this.linkGfx
				.moveTo( sx, sy )
				.lineTo( v.container.x, v.container.y )
				.stroke( {
					color,
					width: v.selected ? 1.8 : 1.4,
					alpha: v.selected ? 0.85 : 0.5,
				} );
		}
	}

	setFocused( focused: GraphNode, detail: PostDetail ): void {
		this.clear();
		this.focused = focused;
		const refs = this.flattenDetail( detail );
		if ( refs.length === 0 ) {
			return;
		}

		const baseR = focused.radius;
		const minSpacing = 36;
		const ringR = Math.max(
			baseR + 86,
			baseR + 70 + ( refs.length * minSpacing ) / ( 2 * Math.PI ),
		);

		const startAngle = -Math.PI / 2;
		const slice = ( 2 * Math.PI ) / refs.length;

		refs.forEach( ( ref, i ) => {
			const angle = startAngle + i * slice;
			const tx = focused.x + Math.cos( angle ) * ringR;
			const ty = focused.y + Math.sin( angle ) * ringR;

			const view = this.buildSatellite( ref, focused.x, focused.y );
			view.targetX = tx;
			view.targetY = ty;
			this.views.push( view );
		} );

		this.animateIn();
	}

	setSelectedKey( key: string | null ): void {
		if ( this.selectedKey === key ) {
			return;
		}
		this.selectedKey = key;
		for ( const v of this.views ) {
			const next = v.key === key;
			if ( next === v.selected ) {
				continue;
			}
			v.selected = next;
			this.repaintDisc( v );
		}
		this.drawLinks();
	}

	destroy(): void {
		if ( this.rafId !== null ) {
			cancelAnimationFrame( this.rafId );
			this.rafId = null;
		}
		this.clear();
		this.layer.destroy( { children: true } );
		this.linkGfx.destroy();
		this.hoverEl.remove();
	}

	private flattenDetail( detail: PostDetail ): SatelliteRef[] {
		const out: SatelliteRef[] = [];

		if ( detail.author ) {
			out.push( {
				kind: 'user',
				userId: detail.author.id,
				label: detail.author.name,
				meta: __( 'Author' ),
				avatar: detail.author.avatar,
			} );
		}
		for ( const u of detail.contributors.slice( 0, 8 ) ) {
			out.push( {
				kind: 'user',
				userId: u.id,
				label: u.name,
				meta: __( 'Contributor' ),
				avatar: u.avatar,
			} );
		}
		for ( const t of detail.categories.slice( 0, 12 ) ) {
			out.push( {
				kind: 'term',
				termId: t.id,
				taxonomy: t.taxonomy,
				label: t.name,
				meta: sprintf(

					__( '%1$s · %2$d posts' ),
					t.tax_label,
					t.count,
				),
			} );
		}
		for ( const c of detail.comments.slice( 0, 8 ) ) {
			out.push( {
				kind: 'comment',
				commentId: c.id,
				label: c.author,
				meta: c.excerpt || formatDate( c.date ),
			} );
		}
		for ( const m of detail.attached_media.slice( 0, 12 ) ) {
			out.push( {
				kind: 'media',
				mediaId: m.id,
				label: m.title,
				meta: m.mime,
				thumb: m.thumb,
			} );
		}
		for ( const r of detail.revisions.slice( 0, 8 ) ) {
			out.push( {
				kind: 'revision',
				revisionId: r.id,
				parentId: detail.post.id,
				label: r.author?.name ?? __( 'Revision' ),
				meta: formatDate( r.date ),
			} );
		}
		return out;
	}

	private buildSatellite(
		ref: SatelliteRef,
		startX: number,
		startY: number,
	): SatelliteView {
		const container = new this.pixi.Container();
		container.x = startX;
		container.y = startY;
		container.alpha = 0;
		container.eventMode = 'static';
		container.cursor = 'pointer';
		const hitR = DISC_RADIUS + 4;
		container.hitArea = {
			contains: ( x: number, y: number ) => {
				return x >= -hitR && x <= hitR && y >= -hitR && y <= hitR + 18;
			},
		};

		const disc = new this.pixi.Graphics();
		container.addChild( disc );

		const dashName =
			ref.kind === 'term' ? iconForTermRef( ref ) : KIND_DASHICON[ ref.kind ];
		const iconChar = resolveDashicon( dashName );

		const icon = new this.pixi.Text( {
			text: iconChar ?? '?',
			style: {
				fontFamily: iconChar ? 'dashicons' : 'sans-serif',
				fontSize: iconChar ? 20 : 13,
				fill: 0xffffff,
			},
			resolution: 2,
			anchor: { x: 0.5, y: 0.5 },
		} );
		const nudge = KIND_ICON_NUDGE[ ref.kind ];
		icon.x = nudge?.x ?? 0;
		icon.y = nudge?.y ?? 0;
		container.addChild( icon );

		const labelText = truncate( ref.label || '—', 28 );

		const labelBg = new this.pixi.Graphics();
		container.addChild( labelBg );

		const label = new this.pixi.Text( {
			text: labelText,
			style: {
				fill: 0x1a1f2b,
				fontSize: 11,
				fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
				fontWeight: '500',
			},
			resolution: 2,
			anchor: { x: 0.5, y: 0 },
		} );
		label.x = 0;
		label.y = DISC_RADIUS + 2;
		container.addChild( label );

		const padX = 6;
		const padY = 1;
		const lw = label.width + padX * 2;
		const lh = label.height + padY * 2;
		labelBg
			.roundRect( -lw / 2, label.y - padY, lw, lh, 4 )
			.fill( { color: 0xffffff, alpha: 0.92 } )
			.stroke( { color: 0x000000, alpha: 0.08, width: 1 } );

		container.on( 'pointerdown', ( evt: unknown ) => {
			const e = evt as { stopPropagation?: () => void };
			e.stopPropagation?.();

			this.claimPointer();
		} );
		container.on( 'pointerover', ( evt: unknown ) => {
			disc.alpha = 1;
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointermove', ( evt: unknown ) => {
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointerout', () => {
			disc.alpha = 0.95;
			this.hideTooltip();
		} );
		container.on( 'pointertap', ( evt: unknown ) => {
			const e = evt as { stopPropagation?: () => void };
			e.stopPropagation?.();
			this.hideTooltip();

			this.setSelectedKey( keyForRef( ref ) );
			this.onClick( ref );
		} );

		this.layer.addChild( container );

		const view: SatelliteView = {
			ref,
			key: keyForRef( ref ),
			container,
			disc,
			icon,
			label,
			targetX: startX,
			targetY: startY,
			selected: false,
		};
		this.repaintDisc( view );
		return view;
	}

	private repaintDisc( v: SatelliteView ): void {
		const fill = KIND_COLOR[ v.ref.kind ];
		v.disc.clear();
		if ( v.selected ) {
			v.disc.circle( 0, 0, DISC_RADIUS + 6 ).fill( { color: fill, alpha: 0.18 } );
		}
		v.disc
			.circle( 0, 0, DISC_RADIUS )
			.fill( { color: fill, alpha: 0.95 } )
			.stroke( {
				color: 0xffffff,
				width: v.selected ? 2.5 : 1.5,
				alpha: 1,
			} );
	}

	private animateIn(): void {
		const t0 = performance.now();
		const duration = 240;
		const starts = this.views.map( ( v ) => ( {
			x: v.container.x,
			y: v.container.y,
		} ) );

		const frame = ( now: number ) => {
			const t = Math.min( 1, ( now - t0 ) / duration );
			const k = 1 - Math.pow( 1 - t, 3 );
			for ( let i = 0; i < this.views.length; i++ ) {
				const v = this.views[ i ];
				const s = starts[ i ];
				v.container.x = s.x + ( v.targetX - s.x ) * k;
				v.container.y = s.y + ( v.targetY - s.y ) * k;
				v.container.alpha = k;
			}
			this.drawLinks();
			if ( t < 1 ) {
				this.rafId = requestAnimationFrame( frame );
			} else {
				this.rafId = null;
			}
		};
		this.rafId = requestAnimationFrame( frame );
	}

	private showTooltip(
		ref: SatelliteRef,
		global?: { x: number; y: number },
	): void {
		this.hoverEl.hidden = false;
		this.hoverEl.innerHTML =
      `<strong>${ escapeHtml( ref.label || '—' ) }</strong>` +
      ( ref.meta ? `<span>${ escapeHtml( ref.meta ) }</span>` : '' );
		if ( global ) {
			this.hoverEl.style.left = `${ global.x + 14 }px`;
			this.hoverEl.style.top = `${ global.y + 14 }px`;
		}
	}

	private hideTooltip(): void {
		this.hoverEl.hidden = true;
	}
}

export function keyForRef( ref: SatelliteRef ): string {
	switch ( ref.kind ) {
		case 'user':
			return `user:${ ref.userId }`;
		case 'term':
			return `term:${ ref.taxonomy }:${ ref.termId }`;
		case 'comment':
			return `comment:${ ref.commentId }`;
		case 'media':
			return `media:${ ref.mediaId }`;
		case 'revision':
			return `revision:${ ref.revisionId }`;
	}
}

function truncate( text: string, max: number ): string {
	if ( text.length <= max ) {
		return text;
	}
	return text.slice( 0, max - 1 ).trimEnd() + '…';
}

function formatDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString();
	} catch {
		return iso;
	}
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}
