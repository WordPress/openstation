import { Component, defineComponent, html } from '../../core';
import '../os-button/os-button';
import '../os-context-menu/os-context-menu';
import { placeAfterRender } from '../../util/menu-position';
import { styles } from './os-action-menu.styles';
export class OsActionMenu extends Component {
	static props = [ 'label', 'text' ] as const;
	static styles = [ styles ];
	static help = {
		title: 'Action menu', status: 'stable',
		summary: 'Compact Actions dropdown with viewport placement, keyboard navigation and focus restoration. Uses the browser top layer to escape card and window clipping.',
		props: [ { name: 'text', type: 'string', description: 'Visible trigger text, default Actions. Pass a translated label from the caller.' }, { name: 'label', type: 'string', description: 'Accessible trigger and menu name.' } ],
		slots: [ { name: '(default)', description: 'os-context-menu-option children; supports headings and disabled items.' } ],
		events: [ { name: 'os-context-menu-pick', detail: '{ id, value }', description: 'The selected option’s existing event bubbles after the menu closes.' } ],
		example: html`<os-action-menu label="Account actions"><os-context-menu-option id="profile">View profile</os-context-menu-option></os-action-menu>`,
	} as const;
	private opened = false;
	private listeners: AbortController | null = null;
	private get panel(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.panel' ) ?? null;
	}
	private get trigger(): HTMLButtonElement | null {
		return this.shadowRoot?.querySelector( 'os-button' )?.shadowRoot?.querySelector( 'button' ) ?? null;
	}
	private options(): HTMLElement[] {
		return Array.from( this.querySelectorAll< HTMLElement >( 'os-context-menu-option:not([heading]):not([disabled])' ) );
	}

	protected render() {
		return html`<os-button variant="ghost" @click=${ () => this.opened ? this.close() : this.show() } @keydown=${ ( e: KeyboardEvent ) => {
			if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
				e.preventDefault();
				this.show( e.key === 'ArrowUp' );
			}
		} }>${ this.getAttribute( 'text' ) || 'Actions' } <span class="chevron" aria-hidden="true"></span></os-button>
		<div class="panel" popover="manual" hidden><os-context-menu open aria-label=${ this.getAttribute( 'label' ) || 'Actions' }><slot></slot></os-context-menu></div>`;
	}
	protected requestUpdate(): void {
		if ( this.opened ) {
			this.close( false );
		}
		super.requestUpdate();
		queueMicrotask( () => queueMicrotask( () => this.syncTrigger() ) );
	}
	private syncTrigger(): void {
		this.trigger?.setAttribute( 'aria-label', this.getAttribute( 'label' ) || 'Actions' );
		this.trigger?.setAttribute( 'aria-haspopup', 'menu' );
		this.trigger?.setAttribute( 'aria-expanded', String( this.opened ) );
	}

	show( last = false ): void {
		if ( this.opened || ! this.panel ) {
			return;
		}
		this.opened = true; this.panel.hidden = false; this.panel.showPopover?.(); this.syncTrigger();
		const panel = this.panel;
		placeAfterRender( panel, ( rect ) => {
			if ( ! this.opened ) {
				return;
			}
			const anchor = this.getBoundingClientRect();
			const rtl = getComputedStyle( this ).direction === 'rtl';
			panel.style.left = `${ Math.max( 8, Math.min( rtl ? anchor.left : anchor.right - rect.width, window.innerWidth - rect.width - 8 ) ) }px`;
			panel.style.top = `${ Math.max( 8, Math.min( anchor.bottom + 5 + rect.height <= window.innerHeight - 8 ? anchor.bottom + 5 : anchor.top - rect.height - 5, window.innerHeight - rect.height - 8 ) ) }px`;
			const options = this.options(); options[ last ? options.length - 1 : 0 ]?.focus( { preventScroll: true } );
		} );
		this.listeners = new AbortController(); const { signal } = this.listeners;
		document.addEventListener( 'pointerdown', ( e ) => {
			if ( ! e.composedPath().includes( this ) ) {
				this.close( false );
			}
		}, { capture: true, signal } );
		document.addEventListener( 'focusin', ( e ) => {
			if ( ! e.composedPath().includes( this ) ) {
				this.close( false );
			}
		}, { signal } );
		document.addEventListener( 'scroll', ( e ) => {
			if ( ! e.composedPath().includes( panel ) ) {
				this.close( false );
			}
		}, { capture: true, signal } );
		window.addEventListener( 'resize', () => this.close( false ), { signal } );
		this.addEventListener( 'keydown', this.onKey, { signal } );
		this.addEventListener( 'os-context-menu-pick', () => this.close(), { capture: true, signal } );
	}

	close( restore = true ): void {
		if ( ! this.opened ) {
			return;
		}
		this.opened = false; this.listeners?.abort(); this.listeners = null;
		if ( this.panel?.isConnected ) {
			this.panel.hidePopover?.();
		} if ( this.panel ) {
			this.panel.hidden = true;
		}
		this.syncTrigger(); if ( restore && this.isConnected ) {
			this.trigger?.focus( { preventScroll: true } );
		}
	}
	private onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' || e.key === 'Tab' ) {
			if ( e.key === 'Escape' ) {
				e.preventDefault(); e.stopPropagation();
			}
			this.close(); return;
		}
		if ( ! [ 'ArrowDown', 'ArrowUp', 'Home', 'End' ].includes( e.key ) ) {
			return;
		}
		e.preventDefault(); e.stopPropagation();
		const options = this.options(); const index = options.indexOf( this.ownerDocument.activeElement as HTMLElement );
		let next = index + ( e.key === 'ArrowUp' ? -1 : 1 );
		if ( e.key === 'Home' ) {
			next = 0;
		}
		if ( e.key === 'End' ) {
			next = options.length - 1;
		}
		options[ ( next + options.length ) % options.length ]?.focus();
	};
	disconnectedCallback(): void {
		this.close( false );
	}
}
defineComponent( 'os-action-menu', OsActionMenu );
