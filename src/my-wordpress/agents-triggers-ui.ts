/**
 * My WordPress — Agents trigger configurator.
 *
 * Each trigger kind ("drag", "chat", "hook", "endpoint", "agent")
 * gets a small kind-specific form rendered inline inside a trigger
 * card. The configurator stores Trigger[] in component state and
 * notifies the parent renderer via `onChange` whenever the user
 * commits a change — the parent is responsible for round-tripping to
 * `setTriggers()` on the REST adapter.
 *
 * @internal
 * @since 0.23.0
 */

import { __, sprintf } from '../i18n';
import type {
	HookSuggestion,
	Trigger,
	TriggerKind,
	TriggerKindDescriptor,
} from './agents-types';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-select/wpd-select';
import '../ui/components/wpd-text-field/wpd-text-field';

/** Dashicon glyph per trigger kind. */
const TRIGGER_ICON: Record< string, string > = {
	'send-to': 'dashicons-share-alt',
	drag: 'dashicons-move',
	chat: 'dashicons-format-chat',
	hook: 'dashicons-admin-plugins',
	endpoint: 'dashicons-rest-api',
	agent: 'dashicons-networking',
};

interface ConfigState {
	triggers: Trigger[];
	kinds: TriggerKindDescriptor[];
	hooks: HookSuggestion[];
	onChange: ( triggers: Trigger[] ) => void;
}

/**
 * Build the full Triggers panel — list of cards + "Add" button.
 *
 * @public
 */
export function buildTriggersPanel( state: ConfigState ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-triggers';

	const list = document.createElement( 'ul' );
	list.className = 'desktop-mode-my-wordpress__agent-triggers-list';
	wrap.appendChild( list );

	function notify(): void {
		state.onChange( state.triggers.slice() );
	}

	function repaint(): void {
		list.replaceChildren();
		if ( state.triggers.length === 0 ) {
			const empty = document.createElement( 'p' );
			empty.className = 'desktop-mode-my-wordpress__agent-triggers-empty';
			empty.textContent = __(
				'No triggers yet — add one to wire this agent up.',
				'desktop-mode',
			);
			list.appendChild( empty );
			return;
		}
		state.triggers.forEach( ( trigger, index ) => {
			list.appendChild(
				buildTriggerCard( {
					trigger,
					hooks: state.hooks,
					onDelete: () => {
						state.triggers.splice( index, 1 );
						notify();
						repaint();
					},
					onUpdate: ( next ) => {
						state.triggers[ index ] = next;
						notify();
						repaint();
					},
				} ),
			);
		} );
	}

	// Visual card grid as the kind picker — one tile per kind, each
	// with an icon + label + one-line description. Click a card to add
	// a trigger of that kind with sensible defaults. No popover, no
	// dropdown — every kind is discoverable at a glance.
	const add = document.createElement( 'div' );
	add.className = 'desktop-mode-my-wordpress__agent-triggers-add';

	const addHeading = document.createElement( 'p' );
	addHeading.className =
		'desktop-mode-my-wordpress__agent-triggers-add-heading';
	addHeading.textContent = __( 'Add a trigger', 'desktop-mode' );
	add.appendChild( addHeading );

	const grid = document.createElement( 'div' );
	grid.className = 'desktop-mode-my-wordpress__agent-triggers-add-grid';
	for ( const kind of state.kinds ) {
		const card = document.createElement( 'button' );
		card.type = 'button';
		card.className =
			'desktop-mode-my-wordpress__agent-trigger-add-card';
		card.dataset.kind = kind.slug;

		const icon = document.createElement( 'span' );
		icon.className =
			'desktop-mode-my-wordpress__agent-trigger-add-card-icon dashicons ' +
			( kind.icon ?? TRIGGER_ICON[ kind.slug ] ?? 'dashicons-flag' );
		icon.setAttribute( 'aria-hidden', 'true' );
		card.appendChild( icon );

		const labelEl = document.createElement( 'strong' );
		labelEl.className =
			'desktop-mode-my-wordpress__agent-trigger-add-card-label';
		labelEl.textContent = kind.label;
		card.appendChild( labelEl );

		if ( kind.description ) {
			const desc = document.createElement( 'span' );
			desc.className =
				'desktop-mode-my-wordpress__agent-trigger-add-card-desc';
			desc.textContent = kind.description;
			card.appendChild( desc );
		}

		card.addEventListener( 'click', ( ev ) => {
			ev.preventDefault();
			state.triggers.push( buildDefaultTrigger( kind.slug ) );
			notify();
			repaint();
		} );

		grid.appendChild( card );
	}
	add.appendChild( grid );
	wrap.appendChild( add );

	repaint();
	return wrap;
}

function buildDefaultTrigger( kind: TriggerKind ): Trigger {
	switch ( kind ) {
		case 'send-to':
			// Most agents are post-shaped; pre-tick `post` so a fresh
			// trigger isn't useless out of the box.
			return { kind, config: { entityKinds: [ 'post' ] } };
		case 'drag':
			return {
				kind,
				config: { mimeTypes: [], entityKinds: [] },
			};
		case 'chat':
			return { kind, config: { capability: 'edit_posts' } };
		case 'hook':
			return { kind, config: { hook: '', priority: 10 } };
		case 'endpoint':
			return {
				kind,
				config: { auth: 'capability', capability: 'edit_posts' },
			};
		case 'agent':
			return { kind, config: { fromAgents: [] } };
		default:
			return { kind, config: {} };
	}
}

interface CardArgs {
	trigger: Trigger;
	hooks: HookSuggestion[];
	onDelete: () => void;
	onUpdate: ( next: Trigger ) => void;
}

function buildTriggerCard( args: CardArgs ): HTMLElement {
	const li = document.createElement( 'li' );
	li.className = 'desktop-mode-my-wordpress__agent-trigger-card';
	li.dataset.triggerKind = args.trigger.kind;

	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__agent-trigger-card-header';

	const iconEl = document.createElement( 'span' );
	iconEl.className =
		'desktop-mode-my-wordpress__agent-trigger-icon dashicons ' +
		( TRIGGER_ICON[ args.trigger.kind ] ?? 'dashicons-flag' );
	iconEl.setAttribute( 'aria-hidden', 'true' );
	header.appendChild( iconEl );

	const label = document.createElement( 'strong' );
	label.textContent = humanLabelFor( args.trigger.kind );
	header.appendChild( label );

	const summary = document.createElement( 'span' );
	summary.className = 'desktop-mode-my-wordpress__agent-trigger-summary';
	summary.textContent = summaryFor( args.trigger );
	header.appendChild( summary );

	const del = document.createElement( 'wpd-button' );
	del.setAttribute( 'variant', 'tertiary' );
	del.setAttribute( 'size', 'compact' );
	del.setAttribute( 'aria-label', __( 'Remove trigger', 'desktop-mode' ) );
	del.textContent = __( 'Remove', 'desktop-mode' );
	del.addEventListener( 'click', ( ev ) => {
		ev.preventDefault();
		args.onDelete();
	} );
	header.appendChild( del );

	li.appendChild( header );

	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-my-wordpress__agent-trigger-body';
	body.appendChild( buildKindForm( args.trigger, args.hooks, args.onUpdate ) );
	li.appendChild( body );

	return li;
}

function humanLabelFor( kind: TriggerKind ): string {
	switch ( kind ) {
		case 'send-to':
			return __( 'Send to (right-click menu)', 'desktop-mode' );
		case 'drag':
			return __( 'Drag & drop', 'desktop-mode' );
		case 'chat':
			return __( 'Chat', 'desktop-mode' );
		case 'hook':
			return __( 'WordPress hook', 'desktop-mode' );
		case 'endpoint':
			return __( 'REST endpoint', 'desktop-mode' );
		case 'agent':
			return __( 'Agent-to-agent', 'desktop-mode' );
		default:
			return String( kind );
	}
}

function summaryFor( trigger: Trigger ): string {
	switch ( trigger.kind ) {
		case 'send-to': {
			const kinds = stringArray( trigger.config.entityKinds );
			return kinds.length
				? sprintf(
					// translators: %s is a comma-separated list of entity kinds.
					__( 'Visible on: %s', 'desktop-mode' ),
					kinds.join( ', ' ),
				)
				: __( '— configure —', 'desktop-mode' );
		}
		case 'drag': {
			const mime = stringArray( trigger.config.mimeTypes );
			const kinds = stringArray( trigger.config.entityKinds );
			const parts: string[] = [];
			if ( mime.length ) {
				parts.push( mime.join( ', ' ) );
			}
			if ( kinds.length ) {
				parts.push( kinds.join( ', ' ) );
			}
			return parts.length
				? parts.join( ' · ' )
				: __( '— configure —', 'desktop-mode' );
		}
		case 'chat': {
			const cap = stringValue( trigger.config.capability );
			return cap ? `cap: ${ cap }` : __( '— configure —', 'desktop-mode' );
		}
		case 'hook': {
			const hook = stringValue( trigger.config.hook );
			return hook ? hook : __( '— configure —', 'desktop-mode' );
		}
		case 'endpoint': {
			const auth = stringValue( trigger.config.auth ) || 'capability';
			return `auth: ${ auth }`;
		}
		case 'agent': {
			const from = stringArray( trigger.config.fromAgents );
			return from.length
				? from.join( ', ' )
				: __( '— configure —', 'desktop-mode' );
		}
		default:
			return '';
	}
}

function buildKindForm(
	trigger: Trigger,
	hooks: HookSuggestion[],
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	switch ( trigger.kind ) {
		case 'send-to':
			return buildSendToForm( trigger, onUpdate );
		case 'drag':
			return buildDragForm( trigger, onUpdate );
		case 'chat':
			return buildChatForm( trigger, onUpdate );
		case 'hook':
			return buildHookForm( trigger, hooks, onUpdate );
		case 'endpoint':
			return buildEndpointForm( trigger, onUpdate );
		case 'agent':
			return buildAgentForm( trigger, onUpdate );
		default: {
			const fallback = document.createElement( 'p' );
			fallback.textContent = __(
				'No configuration form for this trigger kind yet.',
				'desktop-mode',
			);
			return fallback;
		}
	}
}

function buildSendToForm(
	trigger: Trigger,
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const description = document.createElement( 'p' );
	description.className =
		'desktop-mode-my-wordpress__agent-trigger-form-description';
	description.textContent = __(
		'The agent will appear in the right-click context menu under "Send to…" for the entity kinds you tick below.',
		'desktop-mode',
	);
	wrap.appendChild( description );

	const items = [
		{ slug: 'post', label: __( 'Posts', 'desktop-mode' ) },
		{ slug: 'page', label: __( 'Pages', 'desktop-mode' ) },
		{ slug: 'media', label: __( 'Media', 'desktop-mode' ) },
		{ slug: 'user', label: __( 'Users', 'desktop-mode' ) },
		{ slug: 'comment', label: __( 'Comments', 'desktop-mode' ) },
	];

	const fs = document.createElement( 'fieldset' );
	const legend = document.createElement( 'legend' );
	legend.textContent = __( 'Show on right-click of:', 'desktop-mode' );
	fs.appendChild( legend );

	const enabled = new Set( stringArray( trigger.config.entityKinds ) );
	for ( const item of items ) {
		const id =
			'send-to-' +
			item.slug +
			'-' +
			Math.random().toString( 36 ).slice( 2, 6 );
		const label = document.createElement( 'label' );
		label.htmlFor = id;
		label.className =
			'desktop-mode-my-wordpress__agent-trigger-checkbox';
		const cb = document.createElement( 'input' );
		cb.type = 'checkbox';
		cb.id = id;
		cb.checked = enabled.has( item.slug );
		cb.addEventListener( 'change', () => {
			if ( cb.checked ) {
				enabled.add( item.slug );
			} else {
				enabled.delete( item.slug );
			}
			onUpdate( {
				...trigger,
				config: {
					...trigger.config,
					entityKinds: Array.from( enabled ),
				},
			} );
		} );
		label.appendChild( cb );
		label.appendChild( document.createTextNode( ' ' + item.label ) );
		fs.appendChild( label );
	}
	wrap.appendChild( fs );

	return wrap;
}

function buildDragForm(
	trigger: Trigger,
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const mimes = [
		{ slug: 'image/*', label: __( 'Images', 'desktop-mode' ) },
		{ slug: 'video/*', label: __( 'Videos', 'desktop-mode' ) },
		{ slug: 'audio/*', label: __( 'Audio', 'desktop-mode' ) },
		{ slug: 'application/pdf', label: __( 'PDFs', 'desktop-mode' ) },
	];
	const kinds = [
		{ slug: 'media', label: __( 'Media', 'desktop-mode' ) },
		{ slug: 'post', label: __( 'Posts', 'desktop-mode' ) },
		{ slug: 'page', label: __( 'Pages', 'desktop-mode' ) },
		{ slug: 'user', label: __( 'Users', 'desktop-mode' ) },
		{ slug: 'comment', label: __( 'Comments', 'desktop-mode' ) },
	];

	function row( title: string, items: typeof mimes, key: 'mimeTypes' | 'entityKinds' ): HTMLElement {
		const fs = document.createElement( 'fieldset' );
		const legend = document.createElement( 'legend' );
		legend.textContent = title;
		fs.appendChild( legend );
		const enabled = new Set( stringArray( trigger.config[ key ] ) );
		for ( const item of items ) {
			const id = `drag-${ key }-${ item.slug.replace( /\W+/g, '-' ) }`;
			const label = document.createElement( 'label' );
			label.htmlFor = id;
			label.className =
				'desktop-mode-my-wordpress__agent-trigger-checkbox';
			const cb = document.createElement( 'input' );
			cb.type = 'checkbox';
			cb.id = id;
			cb.checked = enabled.has( item.slug );
			cb.addEventListener( 'change', () => {
				if ( cb.checked ) {
					enabled.add( item.slug );
				} else {
					enabled.delete( item.slug );
				}
				const next: Trigger = {
					...trigger,
					config: {
						...trigger.config,
						[ key ]: Array.from( enabled ),
					},
				};
				onUpdate( next );
			} );
			label.appendChild( cb );
			label.appendChild( document.createTextNode( ' ' + item.label ) );
			fs.appendChild( label );
		}
		return fs;
	}

	wrap.appendChild( row( __( 'MIME types', 'desktop-mode' ), mimes, 'mimeTypes' ) );
	wrap.appendChild(
		row( __( 'Entity kinds', 'desktop-mode' ), kinds, 'entityKinds' ),
	);
	return wrap;
}

function buildChatForm(
	trigger: Trigger,
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const field = document.createElement( 'wpd-text-field' );
	field.setAttribute( 'label', __( 'Required capability', 'desktop-mode' ) );
	field.setAttribute(
		'value',
		stringValue( trigger.config.capability ) || 'edit_posts',
	);
	field.addEventListener( 'wpd-input-commit', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const next: Trigger = {
			...trigger,
			config: { ...trigger.config, capability: value },
		};
		onUpdate( next );
	} );
	wrap.appendChild( field );

	return wrap;
}

function buildHookForm(
	trigger: Trigger,
	hooks: HookSuggestion[],
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const list = document.createElement( 'datalist' );
	list.id = 'desktop-mode-agent-hooks-' + Math.random().toString( 36 ).slice( 2 );
	for ( const suggestion of hooks ) {
		const option = document.createElement( 'option' );
		option.value = suggestion.hook;
		option.textContent = suggestion.when;
		list.appendChild( option );
	}
	wrap.appendChild( list );

	const hookField = document.createElement( 'wpd-text-field' );
	hookField.setAttribute( 'label', __( 'Hook name', 'desktop-mode' ) );
	hookField.setAttribute( 'value', stringValue( trigger.config.hook ) );
	hookField.setAttribute(
		'placeholder',
		__( 'e.g. save_post', 'desktop-mode' ),
	);
	hookField.setAttribute( 'list', list.id );
	hookField.addEventListener( 'wpd-input-commit', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const next: Trigger = {
			...trigger,
			config: { ...trigger.config, hook: value },
		};
		onUpdate( next );
	} );
	wrap.appendChild( hookField );

	const priorityField = document.createElement( 'wpd-text-field' );
	priorityField.setAttribute( 'type', 'number' );
	priorityField.setAttribute( 'label', __( 'Priority', 'desktop-mode' ) );
	priorityField.setAttribute(
		'value',
		String( numberValue( trigger.config.priority ) || 10 ),
	);
	priorityField.addEventListener( 'wpd-input-commit', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const priority = Number.parseInt( value, 10 );
		const next: Trigger = {
			...trigger,
			config: {
				...trigger.config,
				priority: Number.isFinite( priority ) ? priority : 10,
			},
		};
		onUpdate( next );
	} );
	wrap.appendChild( priorityField );

	return wrap;
}

function buildEndpointForm(
	trigger: Trigger,
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const authLabel = document.createElement( 'label' );
	authLabel.textContent = __( 'Authentication', 'desktop-mode' );
	wrap.appendChild( authLabel );

	const authSel = document.createElement( 'wpd-select' );
	for ( const opt of [
		{ value: 'capability', label: __( 'Capability', 'desktop-mode' ) },
		{ value: 'nonce', label: __( 'Nonce', 'desktop-mode' ) },
		{ value: 'anonymous', label: __( 'Anonymous (public)', 'desktop-mode' ) },
	] ) {
		const option = document.createElement( 'wpd-option' );
		option.setAttribute( 'value', opt.value );
		option.textContent = opt.label;
		authSel.appendChild( option );
	}
	authSel.setAttribute(
		'value',
		stringValue( trigger.config.auth ) || 'capability',
	);
	authSel.addEventListener( 'wpd-pick', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const next: Trigger = {
			...trigger,
			config: { ...trigger.config, auth: value },
		};
		onUpdate( next );
	} );
	wrap.appendChild( authSel );

	const capField = document.createElement( 'wpd-text-field' );
	capField.setAttribute( 'label', __( 'Required capability', 'desktop-mode' ) );
	capField.setAttribute(
		'value',
		stringValue( trigger.config.capability ) || 'edit_posts',
	);
	capField.addEventListener( 'wpd-input-commit', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const next: Trigger = {
			...trigger,
			config: { ...trigger.config, capability: value },
		};
		onUpdate( next );
	} );
	wrap.appendChild( capField );

	return wrap;
}

function buildAgentForm(
	trigger: Trigger,
	onUpdate: ( next: Trigger ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-trigger-form';

	const field = document.createElement( 'wpd-text-field' );
	field.setAttribute(
		'label',
		__( 'Incoming from agents (comma-separated slugs)', 'desktop-mode' ),
	);
	field.setAttribute(
		'value',
		stringArray( trigger.config.fromAgents ).join( ', ' ),
	);
	field.addEventListener( 'wpd-input-commit', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail.value;
		const list = value
			.split( ',' )
			.map( ( s ) => s.trim() )
			.filter( ( s ) => s.length > 0 );
		const next: Trigger = {
			...trigger,
			config: { ...trigger.config, fromAgents: list },
		};
		onUpdate( next );
	} );
	wrap.appendChild( field );

	return wrap;
}

function stringArray( value: unknown ): string[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}
	return value.filter( ( v ): v is string => typeof v === 'string' );
}

function stringValue( value: unknown ): string {
	return typeof value === 'string' ? value : '';
}

function numberValue( value: unknown ): number {
	if ( typeof value === 'number' && Number.isFinite( value ) ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const n = Number.parseFloat( value );
		return Number.isFinite( n ) ? n : 0;
	}
	return 0;
}
