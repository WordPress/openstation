import { Component, defineComponent, html } from '../../core';
import { segmentStyles, segmentedStyles } from './os-segmented.styles';

export class OsSegment extends Component {
	static props = [ 'value' ] as const;
	static styles = [ segmentStyles ];

	static help = {
		title: 'Segment',
		summary:
			'Single pill inside a <os-segmented> group. Value identifies it for selection; aria-checked is mirrored by the parent.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Identifier this segment contributes to the parent group selection.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Visible segment label.' },
		],
		events: [
			{
				name: 'os-segment-pick',
				description: 'Internal event bubbled to the parent <os-segmented>. Consumers should listen for os-pick on the group instead.',
				detail: '{ value: string }',
			},
		],

		example: html`
			<os-segmented value="md" label="Dock size">
				<os-segment value="sm">Small</os-segment>
				<os-segment value="md">Medium</os-segment>
				<os-segment value="lg">Large</os-segment>
			</os-segmented>
		`,
	} as const;

	protected render() {
		this.setAttribute( 'role', 'radio' );
		return html`
			<button
				type="button"
				class="os-holo-sheen"
				@click=${ () => this._onPick() }
			>
				<slot></slot>
			</button>
		`;
	}

	private _onPick(): void {
		this.emit( 'os-segment-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-segment', OsSegment );

export class OsSegmented extends Component {
	static props = [ 'value', 'label' ] as const;
	static styles = [ segmentedStyles ];

	static help = {
		title: 'Segmented',
		summary:
			'iOS-style segmented radio group. Pill-shaped bar of equal-width <os-segment> children where exactly one is active.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently selected segment value. Mirrored onto child aria-checked.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'aria-label for the radiogroup.',
			},
		],
		slots: [
			{ name: '(default)', description: '<os-segment value="…"> children.' },
		],
		events: [
			{
				name: 'os-pick',
				description: 'Fires when the selected segment changes.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--os-window-bg', description: 'Pill background.' },
			{ name: '--os-ui-fg', description: 'Active label colour.' },
			{ name: '--os-ui-fg-muted', description: 'Inactive label colour.' },
		],
		example: html`
			<os-segmented value="md" label="Dock size">
				<os-segment value="sm">Small</os-segment>
				<os-segment value="md">Medium</os-segment>
				<os-segment value="lg">Large</os-segment>
			</os-segmented>
		`,
	} as const;

	private _resizeObserver: ResizeObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();

		this.addEventListener( 'os-segment-pick', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value: string };
			e.stopPropagation();
			( this as unknown as { value: string } ).value = detail.value;
			this.emit( 'os-pick', { value: detail.value } );
		} );

		if ( typeof ResizeObserver !== 'undefined' ) {
			this._resizeObserver = new ResizeObserver( () => this._placeThumb() );
			this._resizeObserver.observe( this );
		}
	}

	disconnectedCallback(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
	}

	private _placeThumb(): void {
		const thumb = this.shadowRoot?.querySelector(
			'.os-segmented__thumb',
		) as HTMLElement | null;
		if ( ! thumb ) {
			return;
		}
		const current = ( this as unknown as { value: string | null } ).value;
		const selected = Array.from(
			this.querySelectorAll( ':scope > os-segment' ),
		).find( ( el ) => el.getAttribute( 'value' ) === current );
		if ( ! selected || this.offsetWidth === 0 ) {
			this.removeAttribute( 'data-thumb' );
			return;
		}
		const host = this.getBoundingClientRect();

		const raw = host.width / this.offsetWidth;

		const scale = Math.abs( raw - 1 ) < 0.02 ? 1 : raw;
		if ( ! ( scale > 0 ) ) {
			return;
		}
		const box = selected.getBoundingClientRect();

		const px = ( v: number ) => `${ Math.round( v * 100 ) / 100 }px`;
		this.style.setProperty( '--_thumb-x', px( ( box.left - host.left ) / scale ) );
		this.style.setProperty( '--_thumb-w', px( box.width / scale ) );
		this.setAttribute( 'data-thumb', '' );

		if ( ! this.hasAttribute( 'data-thumb-ready' ) ) {
			requestAnimationFrame( () =>
				this.setAttribute( 'data-thumb-ready', '' ),
			);
		}
	}

	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		const existing = this.querySelectorAll( ':scope > os-segment' );
		for ( const el of Array.from( existing ) ) {
			el.remove();
		}
		for ( const item of list ) {
			const seg = document.createElement( 'os-segment' );
			seg.setAttribute( 'value', item.value );
			seg.textContent = item.label;
			this.appendChild( seg );
		}
		const current =
			( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		} else {
			this.requestUpdate();
		}
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}
		this.setAttribute( 'role', 'radiogroup' );

		const current = ( this as unknown as { value: string | null } ).value;
		queueMicrotask( () => {
			const segs = this.querySelectorAll( 'os-segment' );
			for ( const seg of Array.from( segs ) ) {
				const v = seg.getAttribute( 'value' );
				seg.setAttribute(
					'aria-checked',
					v === current ? 'true' : 'false',
				);
			}
			this._placeThumb();
		} );

		return html`<span class="os-segmented__thumb" aria-hidden="true"></span
			><slot></slot>`;
	}
}
defineComponent( 'os-segmented', OsSegmented );
