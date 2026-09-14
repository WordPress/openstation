/** MIO's floating conversation. The shared escaped Markdown renderer keeps model markup inert. */
import '../../ui/components/os-textarea/os-textarea';
import type { OsTextarea } from '../../ui/components/os-textarea/os-textarea';
import { __ } from '../../i18n';
import { mioResponseActionRow } from './response-action-row';
import { renderMarkdown } from '../../markdown';
import type { MioSession } from './session';

export interface MioChatHandle {
	destroy: () => void;
}

export function mountMioChat(
	host: HTMLElement,
	title: string,
	session: MioSession,
	close: () => void,
): MioChatHandle {
	const panel = document.createElement( 'section' );
	panel.className = 'os-mio-chat';
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-label', `${ __( 'Chat with MIO' ) } · ${ title }` );
	const header = document.createElement( 'header' );
	const name = document.createElement( 'strong' );
	name.textContent = 'MIO';
	const subtitle = document.createElement( 'span' );
	subtitle.textContent = title;
	const dismiss = document.createElement( 'os-button' );
	dismiss.setAttribute( 'variant', 'ghost' );
	dismiss.setAttribute( 'aria-label', __( 'Close MIO chat' ) );
	const closeIcon = document.createElement( 'span' );
	closeIcon.textContent = '×';
	closeIcon.setAttribute( 'aria-hidden', 'true' );
	const closeLabel = document.createElement( 'span' );
	closeLabel.className = 'screen-reader-text';
	closeLabel.textContent = __( 'Close MIO chat' );
	dismiss.append( closeIcon, closeLabel );
	dismiss.addEventListener( 'click', close );
	header.append( name, subtitle, dismiss );
	const log = document.createElement( 'div' );
	log.className = 'os-mio-chat__log';
	log.setAttribute( 'role', 'log' );
	log.setAttribute( 'aria-live', 'polite' );
	log.setAttribute( 'aria-label', __( 'Conversation' ) );
	const status = document.createElement( 'p' );
	status.className = 'os-mio-chat__status';
	status.setAttribute( 'role', 'status' );
	status.textContent = __( 'Ask about this window, or tell me what to change.' );
	const activity = document.createElement( 'div' );
	activity.className = 'os-mio-chat__activity';
	const dots = document.createElement( 'span' );
	dots.className = 'os-mio-chat__thinking';
	dots.setAttribute( 'aria-hidden', 'true' );
	dots.append( ...Array.from( { length: 3 }, () => document.createElement( 'i' ) ) );
	activity.append( dots, status );
	const unsubscribeThinking = session.subscribeThinking( ( thinking ) => {
		panel.dataset.thinking = String( thinking );
		log.setAttribute( 'aria-busy', String( thinking ) );
	} );
	const input = document.createElement( 'os-textarea' ) as OsTextarea;
	input.setAttribute( 'aria-label', __( 'Message MIO' ) );
	input.setAttribute( 'rows', '1' );
	input.setAttribute( 'auto-grow', '' );
	input.setAttribute( 'max-rows', '2' );
	input.setAttribute( 'submit-on-enter', '' );
	input.setAttribute( 'placeholder', __( 'Make this space yours…' ) );
	input.setAttribute( 'maxlength', '4000' );
	const send = document.createElement( 'os-button' );
	send.setAttribute( 'variant', 'holo' );
	send.textContent = __( 'Send' );
	const stop = document.createElement( 'os-button' );
	stop.setAttribute( 'variant', 'ghost' );
	stop.textContent = __( 'Stop' );
	stop.hidden = true;
	const form = document.createElement( 'div' );
	form.className = 'os-mio-chat__composer';
	form.append( input, send, stop );
	const privacy = document.createElement( 'small' );
	privacy.textContent = __(
		'Conversation stays in this session. Messages are sent to your configured AI provider.',
	);
	panel.append( header, log, activity, form, privacy );
	host.appendChild( panel );
	let inputWidth = -1;
	const inputResize = new ResizeObserver( ( entries ) => {
		const width = entries[ 0 ]?.contentRect.width;
		if ( width !== undefined && width !== inputWidth ) {
			inputWidth = width; input.refreshAutosize();
		}
	} );
	inputResize.observe( input );
	let draft = '';
	let busy = false;
	let destroyed = false;
	let renderedLast = '';
	const bubbles = new Map<string, { bubble: HTMLElement; update:() => void; destroy: () => void }>();
	const paint = (): void => {
		const scroll = log.scrollTop;
		const messages = session.conversation.read();
		const last = JSON.stringify( messages[ messages.length - 1 ] ?? null );
		const live = new Set<string>();
		for ( const [ index, message ] of messages.entries() ) {
			const key = `${ message.id ?? index }:${ message.role }:${ message.text }`;
			live.add( key );
			const existing = bubbles.get( key );
			if ( existing ) {
				existing.update(); continue;
			}
			const bubble = document.createElement( 'div' );
			bubble.className = `os-mio-chat__message os-mio-chat__message--${ message.role }`;
			if ( message.role === 'assistant' ) {
				bubble.innerHTML = renderMarkdown( message.text );
			} else {
				bubble.textContent = message.text;
			}
			const row = mioResponseActionRow( message, session.responseActions );
			if ( message.role === 'assistant' ) {
				bubble.appendChild( row.element );
			}
			row.update();
			bubbles.set( key, { bubble, update: row.update, destroy: row.destroy } );
			log.appendChild( bubble );
		}
		for ( const [ key, entry ] of bubbles ) {
			if ( ! live.has( key ) ) {
				entry.destroy(); entry.bubble.remove(); bubbles.delete( key );
			}
		}
		const newest = log.lastElementChild as HTMLElement | null;
		// Start a new message at its beginning, including replies taller than
		// the viewport. Subsequent reading belongs entirely to the user.
		log.scrollTop = last !== renderedLast && newest ? newest.offsetTop : scroll;
		renderedLast = last;
	};
	const unsubscribeActions = session.responseActions.subscribe( () => {
		const scroll = log.scrollTop;
		for ( const entry of bubbles.values() ) {
			entry.update();
		}
		log.scrollTop = scroll;
	} );
	const submit = async (): Promise<void> => {
		if ( busy || ! draft.trim() ) {
			return;
		}
		busy = true;
		send.setAttribute( 'disabled', '' );
		stop.hidden = false;
		status.textContent = __( 'MIO is thinking…' );
		const query = draft;
		draft = '';
		input.clear();
		try {
			const answer = session.ask( query );
			paint();
			await answer;
			status.textContent = '';
		} catch ( error ) {
			if ( error instanceof Error && error.name === 'AbortError' ) {
				const unknown = session.operations.list().some( ( operation ) => operation.effect === 'write' && operation.status === 'unknown' );
				status.textContent = unknown ? __( 'Stopped. A submitted save may still complete.' ) : __( 'Stopped.' );
			} else {
				status.textContent =
					error instanceof Error
						? error.message
						: __( 'MIO could not complete this request.' );
			}
		} finally {
			if ( ! destroyed ) {
				busy = false;
				stop.hidden = true;
				send.removeAttribute( 'disabled' );
				paint();
			}
		}
	};
	input.addEventListener( 'os-input-change', ( event ) => {
		draft = String( ( event as CustomEvent ).detail?.value ?? '' );
	} );
	input.addEventListener( 'os-submit', () => {
		void submit();
	} );
	send.addEventListener( 'click', () => {
		void submit();
	} );
	stop.addEventListener( 'click', () => session.cancel() );
	panel.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			event.stopPropagation();
			close();
		}
	} );
	paint();
	void customElements.whenDefined( 'os-textarea' ).then( () => {
		if ( ! destroyed ) {
			input.focusInput();
		}
	} );
	return {
		destroy: () => {
			destroyed = true;
			inputResize.disconnect();
			unsubscribeThinking();
			unsubscribeActions();
			for ( const entry of bubbles.values() ) {
				entry.destroy();
			}
			bubbles.clear();
			session.cancel();
			panel.remove();
		},
	};
}

declare global {
	interface Window {
		openStationMountMioChat?: typeof mountMioChat;
	}
}
