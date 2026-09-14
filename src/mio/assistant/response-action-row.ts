/** Stable action nodes: pending/error updates never replace a focused button. */
import '../../ui/components/os-icon/os-icon';
import { mioActionFocus } from './action-focus';
import { __ } from '../../i18n';
import type { MioChatMessage } from './types';
import type { MioResponseActions } from './response-actions';

export function mioResponseActionRow( message: MioChatMessage, actions: MioResponseActions ): { element: HTMLElement; update: () => void; destroy: () => void } {
	const element = document.createElement( 'div' );
	element.className = 'os-mio-chat__actions';
	element.setAttribute( 'role', 'group' );
	element.setAttribute( 'aria-label', __( 'Suggested actions' ) );
	const nodes = new Map<string, { item: HTMLElement; button: HTMLElement; status: HTMLElement; focus: ReturnType<typeof mioActionFocus> }>();
	return { element, destroy: () => {
		for ( const node of nodes.values() ) {
			node.focus.dispose();
		} nodes.clear();
	}, update: () => {
		const views = actions.list( message );
		const live = new Set( views.map( ( view ) => view.id ) );
		for ( const [ id, node ] of nodes ) {
			if ( ! live.has( id ) ) {
				node.focus.dispose(); node.item.remove(); nodes.delete( id );
			}
		}
		for ( const view of views ) {
			let node = nodes.get( view.id );
			if ( ! node ) {
				const item = document.createElement( 'div' );
				item.className = 'os-mio-chat__action';
				const button = document.createElement( 'os-button' );
				button.setAttribute( 'variant', view.emphasis === 'primary' ? 'primary' : 'ghost' );
				button.dataset.mioAction = view.id;
				if ( view.icon ) {
					const icon = document.createElement( 'os-icon' );
					icon.setAttribute( 'name', view.icon ); icon.setAttribute( 'aria-hidden', 'true' );
					button.append( icon, ' ' );
				}
				// Put the accessible name in the slot: kit controls own a native
				// button in shadow DOM, so a label on the host alone is insufficient.
				const label = document.createElement( 'span' ); label.textContent = view.label;
				if ( view.ariaLabel ) {
					label.setAttribute( 'aria-hidden', 'true' );
				}
				button.append( label );
				if ( view.ariaLabel ) {
					const accessible = document.createElement( 'span' );
					accessible.className = 'screen-reader-text'; accessible.textContent = view.ariaLabel;
					button.append( accessible );
				}
				const status = document.createElement( 'span' );
				status.className = 'os-mio-chat__action-status';
				status.setAttribute( 'role', 'status' ); status.setAttribute( 'aria-live', 'polite' );
				button.addEventListener( 'click', () => {
					void actions.run( message.id!, view.id );
				} );
				item.append( button, status ); element.appendChild( item );
				node = { item, button, status, focus: mioActionFocus( button ) }; nodes.set( view.id, node );
			}
			node.focus.update( view.pending );
			node.button.toggleAttribute( 'busy', view.pending );
			node.button.toggleAttribute( 'disabled', ! view.available );
			if ( node.status.textContent !== view.status ) {
				node.status.textContent = view.status;
			}
		}
		element.hidden = views.length === 0;
	} };
}
