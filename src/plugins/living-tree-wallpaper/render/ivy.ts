import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { BranchNode } from '../types';

const IVY_TEX_SIZE = 24;

const MAX_IVY = 260;

const IVY_SHADES = [ 0x1e4620, 0x27562a, 0x1a3d22, 0x2f6233 ];

interface IvyLeaf {
	sprite: PixiSprite;
	phase: number;
	alphaMax: number;
}

export function computeIvyBudget( structure01: number ): number {
	const s = Math.min( 1, Math.max( 0, structure01 ) );
	return Math.round( MAX_IVY * Math.pow( s, 0.8 ) );
}

function buildIvyTexture( pixi: PixiNamespace ): PixiTexture {
	const size = IVY_TEX_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';

	for ( const [ lx, ly, lr ] of [
		[ c, c - 3, 6 ],
		[ c - 5, c + 2, 5 ],
		[ c + 5, c + 2, 5 ],
	] ) {
		ctx.beginPath();
		ctx.arc( lx, ly, lr, 0, Math.PI * 2 );
		ctx.fill();
	}
	ctx.beginPath();
	ctx.moveTo( c - 4, c + 5 );
	ctx.lineTo( c, size - 2 );
	ctx.lineTo( c + 4, c + 5 );
	ctx.closePath();
	ctx.fill();
	return pixi.Texture.from( canvas );
}

export class IvyLayer {
	private readonly leaves: IvyLeaf[] = [];
	private texture: PixiTexture | null = null;
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;

	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	public populate(
		nodes: BranchNode[],
		structure01: number,
		rng: () => number,
	): void {
		this.clear();
		this.settled = false;
		if ( nodes.length < 2 || structure01 <= 0 ) {
			return;
		}
		this.texture = this.texture ?? buildIvyTexture( this.pixi );

		let trunkBase = 1;
		for ( const node of nodes ) {
			trunkBase = Math.max( trunkBase, node.radius );
		}
		const minHostRadius = Math.max( 3.4, trunkBase * 0.26 );
		const hosts = nodes
			.filter( ( n ) => n.parent !== null && n.radius > minHostRadius )
			.sort( ( a, b ) => b.pos.y - a.pos.y );
		if ( hosts.length === 0 ) {
			return;
		}

		const budget = Math.min(
			computeIvyBudget( structure01 ),
			hosts.length * 8,
		);

		const reachable = Math.max(
			1,
			Math.round( hosts.length * ( 0.25 + 0.75 * structure01 ) ),
		);

		for ( let i = 0; i < budget; i++ ) {
			const host = hosts[ Math.floor( rng() * reachable ) ];
			const parent = nodes[ host.parent as number ];

			const t = rng();
			const bx = parent.pos.x + ( host.pos.x - parent.pos.x ) * t;
			const by = parent.pos.y + ( host.pos.y - parent.pos.y ) * t;
			const across = ( rng() * 2 - 1 ) * host.radius * 0.85;

			const sprite = new this.pixi.Sprite( this.texture );
			sprite.anchor.set( 0.5 );
			sprite.tint = IVY_SHADES[ Math.floor( rng() * IVY_SHADES.length ) ];
			sprite.alpha = 0;
			sprite.scale.set( ( 6 + rng() * 5 ) / IVY_TEX_SIZE );
			sprite.rotation = ( rng() * 2 - 1 ) * Math.PI;
			sprite.x = bx + across;
			sprite.y = by;
			this.layer.addChild( sprite );
			this.leaves.push( {
				sprite,
				phase: rng() * Math.PI * 2,
				alphaMax: 0.8 + rng() * 0.2,
			} );
		}
	}

	private settled = false;

	public update( dt: number, t: number ): void {
		void t;
		if ( this.settled ) {
			return;
		}
		let pending = false;
		for ( const leaf of this.leaves ) {
			if ( leaf.sprite.alpha < leaf.alphaMax ) {
				leaf.sprite.alpha = Math.min( leaf.alphaMax, leaf.sprite.alpha + dt * 0.7 );
				pending = true;
			}
		}
		this.settled = ! pending && this.leaves.length > 0;
	}

	private clear(): void {
		for ( const leaf of this.leaves ) {
			this.layer.removeChild( leaf.sprite );
			leaf.sprite.destroy();
		}
		this.leaves.length = 0;
	}

	public destroy(): void {
		this.clear();
		if ( this.texture ) {
			this.texture.destroy( true );
			this.texture = null;
		}
	}
}
