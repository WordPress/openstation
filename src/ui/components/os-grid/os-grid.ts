/**
 * `<os-grid>` — neutral CSS grid container. The twin of
 * `<os-stack>` + `<os-cluster>` for 2-dimensional layouts.
 *
 * Usage:
 *
 *   <os-grid columns="4" rows="5" gap="8">
 *     <os-button>7</os-button>
 *     <os-button>8</os-button>
 *     <os-button>9</os-button>
 *     <os-button variant="primary">÷</os-button>
 *     …
 *   </os-grid>
 *
 * Attributes:
 *   - `columns` — integer column count (default 1).
 *   - `rows`    — integer row count (default `auto`; omit for
 *                 content-driven sizing).
 *   - `gap`     — px between grid cells.
 *   - `column-gap`, `row-gap` — per-axis overrides.
 *
 * No `role` is emitted — this is a pure layout primitive.
 * Accessibility semantics are the caller's choice (wrap in
 * `role="grid"` or `role="radiogroup"` if warranted).
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-grid.styles';

export class OsGrid extends Component {
	static props = [ 'columns', 'rows', 'gap', 'column-gap', 'row-gap', 'min-item-width' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Grid',
		summary:
			'Neutral CSS grid container. The 2-D twin of <os-stack>/<os-cluster>. No role is emitted — callers wrap in role="grid"/"radiogroup" if warranted.',
		status: 'stable',
		props: [
			{ name: 'min-item-width', type: 'positive number (px)', description: 'Opt into automatic column fitting at this minimum item width. Overrides columns; spans clamp to the available columns.' },
			{
				name: 'columns',
				type: 'integer',
				default: '1',
				description: 'Number of equal-width columns (repeat(N, minmax(0, 1fr))).',
			},
			{
				name: 'rows',
				type: 'integer',
				description: 'Optional fixed row count. Omit for content-driven sizing.',
			},
			{ name: 'gap', type: 'integer (px)', description: 'Cell spacing on both axes.' },
			{ name: 'column-gap', type: 'integer (px)', description: 'x-axis override.' },
			{ name: 'row-gap', type: 'integer (px)', description: 'y-axis override.' },
		],
		slots: [
			{ name: '(default)', description: 'Grid children; col-span and row-span accept integers 1–12. Spans apply to direct children only.' },
		],
		cssProps: [
			{ name: '--os-ui-grid-columns' },
			{ name: '--os-ui-grid-rows' },
			{ name: '--os-ui-grid-gap' },
			{ name: '--os-ui-grid-column-gap' },
			{ name: '--os-ui-grid-row-gap' },
		],
		example: html`
			<os-grid columns="4" gap="8">
				<os-button>7</os-button>
				<os-button>8</os-button>
				<os-button>9</os-button>
				<os-button variant="primary">÷</os-button>
				<os-button>4</os-button>
				<os-button>5</os-button>
				<os-button>6</os-button>
				<os-button variant="primary">×</os-button>
			</os-grid>
			<os-grid min-item-width="160" gap="12">
				<os-panel col-span="2">A spanning dashboard card</os-panel>
				<os-panel>Summary</os-panel>
				<os-panel>Activity</os-panel>
			</os-grid>
		`,
	} as const;

	private observer: ResizeObserver | null = null;
	private availableWidth = 0;
	private overrides = new Map< string, { value: string; priority: string } >();

	/** Attribute overrides temporarily own a token; removing them restores caller styles. */
	private overrideToken( name: string, value: string | null ): void {
		if ( value !== null ) {
			if ( ! this.overrides.has( name ) ) {
				this.overrides.set( name, { value: this.style.getPropertyValue( name ), priority: this.style.getPropertyPriority( name ) } );
			}
			this.style.setProperty( name, value );
		} else {
			const previous = this.overrides.get( name );
			if ( previous ) {
				if ( previous.value ) {
					this.style.setProperty( name, previous.value, previous.priority );
				} else {
					this.style.removeProperty( name );
				}
				this.overrides.delete( name );
			}
		}
	}

	connectedCallback(): void {
		super.connectedCallback();
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		this.observer = new ResizeObserver( ( entries ) => {
			this.availableWidth = entries[ 0 ].contentRect.width;
			this.updateTracks();
		} );
		this.observer.observe( this );
	}

	disconnectedCallback(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private updateTracks(): void {
		const minimum = Number( this.getAttribute( 'min-item-width' ) );
		const automatic = Number.isFinite( minimum ) && minimum > 0;
		const gap = parseFloat( getComputedStyle( this ).columnGap ) || 0;
		const requested = Number( this.getAttribute( 'columns' ) );
		const fixedColumns = Number.isSafeInteger( requested ) && requested > 0 ? requested : 1;
		const columns = automatic
			? Math.max( 1, Math.floor( ( this.availableWidth + gap ) / ( minimum + gap ) ) )
			: fixedColumns;
		this.style.setProperty( '--_os-grid-tracks', String( columns ) );
		this.toggleAttribute( 'data-single-column', automatic && columns === 1 );
		if ( automatic || ( Number.isSafeInteger( requested ) && requested > 0 ) ) {
			this.overrideToken( '--os-ui-grid-columns', `repeat(${ columns }, minmax(0, 1fr))` );
		} else {
			this.overrideToken( '--os-ui-grid-columns', null );
		}
	}

	protected render() {
		const rows = this.getAttribute( 'rows' );
		if ( rows && /^[1-9]\d*$/.test( rows ) ) {
			this.overrideToken( '--os-ui-grid-rows', `repeat(${ rows }, minmax(0, 1fr))` );
		} else {
			this.overrideToken( '--os-ui-grid-rows', null );
		}
		for ( const name of [ 'gap', 'column-gap', 'row-gap' ] ) {
			const value = this.getAttribute( name );
			if ( value !== null && /^\d+$/.test( value ) ) {
				this.overrideToken( `--os-ui-grid-${ name }`, `${ value }px` );
			} else {
				this.overrideToken( `--os-ui-grid-${ name }`, null );
			}
		}
		this.updateTracks();
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-grid', OsGrid );
