/**
 * App Framework runtime — the attribute vocabulary.
 *
 * A view written in PHP wires interaction with a handful of
 * attributes, and this module is the whole grammar:
 *
 *   os-action="name"     dispatch `name` on the element's natural event
 *   os-bind="key"        write the event's value into state[key], then
 *                        dispatch (`set` when no os-action is given)
 *   os-arg-foo="bar"     extra argument `foo` for the action
 *   os-on="event"        override the natural event (any event name —
 *                        every kit component's event is listened for,
 *                        plus click / dblclick / change / input / submit
 *                        / keydown / contextmenu / toggle)
 *   os-debounce="250"    coalesce rapid triggers (default 250 for the
 *                        continuous events: typing and slider drags)
 *   os-confirm="…"       ask before dispatching (+ os-confirm-title,
 *                        os-confirm-label, os-confirm-danger)
 *   os-poll="30000"      dispatch os-action every N ms while present
 *   os-key="…"           identity for the DOM morph (lists)
 *   os-preserve          the morph never touches this subtree
 *   os-prop-foo='json'   assign JSON to the element's `foo` PROPERTY
 *                        after every render — how property-driven
 *                        components (os-table columns/data, os-log
 *                        entries) are fed from markup
 *
 * Pure functions over elements and events, no shell access — every
 * rule here is exercised by `tests/vitest/app-runtime-bindings.test.ts`.
 *
 * @public
 */

import type { Binding, ConfirmSpec } from './types';

/**
 * Every event a kit component emits, so `os-on="<event>"` works for
 * all of them. Kept in sync with `this.emit( '…' )` calls under
 * `src/ui/components/` by `tests/vitest/app-runtime-bindings.test.ts`.
 */
export const COMPONENT_EVENTS: readonly string[] = [
	'os-avatar-click',
	'os-button-activate',
	'os-cancel',
	'os-card-click',
	'os-categories-change',
	'os-categories-close',
	'os-categories-create',
	'os-categories-delete',
	'os-categories-open',
	'os-chain-remove',
	'os-chain-segment-click',
	'os-chain-segment-dragstart',
	'os-checkbox-change',
	'os-chip-dismiss',
	'os-color-change',
	'os-confirm',
	'os-context-menu-pick',
	'os-copy',
	'os-disclosure-toggle',
	'os-flyout-dismiss',
	'os-form-input',
	'os-form-reset',
	'os-form-submit',
	'os-input-change',
	'os-input-commit',
	'os-log-append',
	'os-menu-item-click',
	'os-modal-cancel',
	'os-multiselect-close',
	'os-multiselect-load-more',
	'os-multiselect-open',
	'os-notice-dismiss',
	'os-pick',
	'os-range-change',
	'os-repeater-add',
	'os-repeater-move',
	'os-repeater-remove',
	'os-role-toggle',
	'os-save-status-change',
	'os-segment-pick',
	'os-series-toggle',
	'os-step-click',
	'os-submit',
	'os-switch-change',
	'os-tab-change',
	'os-tab-pick',
	'os-table-expand-change',
	'os-table-filter-change',
	'os-table-row-click',
	'os-table-selection-change',
	'os-table-sort-change',
	'os-tag-add',
	'os-tag-close',
	'os-tag-open',
	'os-tag-remove',
	'os-tag-suggest',
	'os-toast-action',
	'os-toast-dismiss',
	'os-toast-hold',
	'os-token-field-input',
	'os-token-insert',
	'os-user-pick',
];

/** Native events a trigger may name with `os-on`. */
export const NATIVE_EVENTS: readonly string[] = [
	'click',
	'dblclick',
	'change',
	'input',
	'submit',
	'keydown',
	'contextmenu',
	'toggle',
];

/** The event each tag naturally reports on. Anything else: `click`. */
const DEFAULT_EVENTS: Record< string, string > = {
	'os-button': 'click',
	button: 'click',
	a: 'click',
	'os-avatar': 'os-avatar-click',
	'os-card': 'os-card-click',
	'os-tile': 'click',
	'os-select': 'os-pick',
	'os-segmented': 'os-pick',
	'os-swatch-grid': 'os-pick',
	'os-multiselect': 'os-pick',
	'os-tabs': 'os-tab-change',
	'os-text-field': 'os-input-change',
	'os-textarea': 'os-input-change',
	'os-number-field': 'os-input-change',
	'os-token-field': 'os-token-field-input',
	'os-color-field': 'os-color-change',
	'os-range-field': 'os-range-change',
	'os-switch': 'os-switch-change',
	'os-checkbox': 'os-checkbox-change',
	'os-disclosure': 'os-disclosure-toggle',
	'os-histogram': 'os-series-toggle',
	'os-chip': 'os-chip-dismiss',
	'os-tag-input': 'os-tag-add',
	'os-menu': 'os-menu-item-click',
	'os-context-menu': 'os-context-menu-pick',
	'os-table': 'os-table-row-click',
	'os-category-picker': 'os-categories-change',
	'os-role-picker': 'os-role-toggle',
	'os-user-search': 'os-user-pick',
	'os-repeater': 'os-repeater-add',
	'os-crumb-chain': 'os-chain-segment-click',
	'os-notice': 'os-notice-dismiss',
	'os-flyout': 'os-flyout-dismiss',
	'os-modal': 'os-modal-cancel',
	'os-confirm-dialog': 'os-confirm',
	'os-steps': 'os-step-click',
	'os-window-button': 'os-button-activate',
	'os-form': 'os-form-submit',
	'os-code': 'os-copy',
	details: 'toggle',
	form: 'submit',
	select: 'change',
	input: 'change',
	textarea: 'change',
};

/**
 * Events whose triggers debounce by default: the ones a single
 * gesture fires many times — a keystroke per character while typing,
 * a tick per pixel while dragging a slider. Without `os-range-change`
 * here, one drag of an `<os-range-field>` in a server view queues one
 * request per tick.
 */
const CONTINUOUS_EVENTS = new Set( [
	'os-input-change',
	'os-form-input',
	'os-token-field-input',
	'os-range-change',
	'input',
] );

const DEFAULT_DEBOUNCE = 250;

/** Every event type the runtime listens for on an app root. */
export const LISTENED_EVENTS: readonly string[] = Array.from(
	new Set( [ ...COMPONENT_EVENTS, ...NATIVE_EVENTS, ...Object.values( DEFAULT_EVENTS ) ] ),
);

/** Events that do not bubble and must be captured. */
export const CAPTURED_EVENTS: ReadonlySet< string > = new Set( [ 'toggle' ] );

/** The event an element dispatches on: `os-on` or the tag's default. */
export function eventFor( el: Element ): string {
	const explicit = el.getAttribute( 'os-on' );
	if ( explicit ) {
		return explicit;
	}
	return DEFAULT_EVENTS[ el.tagName.toLowerCase() ] ?? 'click';
}

/** Whether an element carries a trigger at all. */
export function isTrigger( el: Element ): boolean {
	return el.hasAttribute( 'os-action' ) || el.hasAttribute( 'os-bind' );
}

/**
 * Walk up from an event target to the nearest trigger whose event
 * matches, stopping at (and excluding) `root`.
 */
export function findTrigger(
	target: Element | null,
	eventType: string,
	root: Element,
): Element | null {
	let node: Element | null = target;
	while ( node && node !== root ) {
		if ( isTrigger( node ) && eventFor( node ) === eventType ) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

function plainDetail( detail: Record< string, unknown > ): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const [ key, value ] of Object.entries( detail ) ) {
		if ( key === 'originalEvent' || value instanceof Event || value instanceof Node ) {
			continue;
		}
		if ( typeof value === 'function' ) {
			continue;
		}
		out[ key ] = value;
	}
	return out;
}

/**
 * The arguments an event contributes: a CustomEvent's detail fields
 * (`value`, `checked`, `open`, `key`, …), a keyboard event's key and
 * modifiers, a form's fields, or a native control's own value.
 */
export function eventArgs( ev: Event, trigger: Element ): Record< string, unknown > {
	// Only a CustomEvent's detail is data — a UIEvent's `detail` is a
	// click count, which must not leak in as `value`.
	if ( ev instanceof CustomEvent ) {
		const detail = ( ev as CustomEvent< unknown > ).detail;
		if ( detail && typeof detail === 'object' && ! Array.isArray( detail ) ) {
			return plainDetail( detail as Record< string, unknown > );
		}
		if ( detail !== undefined && detail !== null && typeof detail !== 'object' ) {
			return { value: detail };
		}
	}
	if ( ev instanceof KeyboardEvent ) {
		return {
			key: ev.key,
			code: ev.code,
			alt: ev.altKey,
			ctrl: ev.ctrlKey,
			meta: ev.metaKey,
			shift: ev.shiftKey,
		};
	}
	const tag = trigger.tagName.toLowerCase();
	if ( tag === 'form' ) {
		const values: Record< string, unknown > = {};
		new FormData( trigger as HTMLFormElement ).forEach( ( value, name ) => {
			if ( typeof value !== 'string' ) {
				return;
			}
			if ( name in values ) {
				const existing = values[ name ];
				values[ name ] = Array.isArray( existing ) ? [ ...existing, value ] : [ existing, value ];
			} else {
				values[ name ] = value;
			}
		} );
		return { values };
	}
	if ( tag === 'details' ) {
		return { open: ( trigger as HTMLDetailsElement ).open };
	}
	if ( tag === 'input' ) {
		const input = trigger as HTMLInputElement;
		if ( input.type === 'checkbox' || input.type === 'radio' ) {
			return { checked: input.checked, value: input.value };
		}
		return { value: input.value };
	}
	if ( tag === 'select' || tag === 'textarea' ) {
		return { value: ( trigger as HTMLSelectElement | HTMLTextAreaElement ).value };
	}
	return {};
}

/** `os-arg-foo="bar"` attributes as `{ foo: 'bar' }`. */
export function attributeArgs( el: Element ): Record< string, unknown > {
	const out: Record< string, unknown > = {};
	for ( const attr of Array.from( el.attributes ) ) {
		if ( attr.name.startsWith( 'os-arg-' ) ) {
			out[ attr.name.slice( 'os-arg-'.length ) ] = attr.value;
		}
	}
	return out;
}

/**
 * The value `os-bind` writes: `checked` when the control reports one
 * (a switch or checkbox also carries a `value` — its identifier, not
 * its state), else `value`, else `open`.
 */
export function boundValue( args: Record< string, unknown > ): unknown {
	if ( 'checked' in args ) {
		return args.checked;
	}
	if ( 'value' in args ) {
		return args.value;
	}
	if ( 'open' in args ) {
		return args.open;
	}
	return undefined;
}

/** Read `os-confirm*` into a spec, or null when absent. */
export function confirmSpec( el: Element ): ConfirmSpec | null {
	const message = el.getAttribute( 'os-confirm' );
	if ( ! message ) {
		return null;
	}
	return {
		message,
		title: el.getAttribute( 'os-confirm-title' ) ?? undefined,
		label: el.getAttribute( 'os-confirm-label' ) ?? undefined,
		danger: el.hasAttribute( 'os-confirm-danger' ),
	};
}

/** Resolve everything a trigger says, for one event. */
export function readBinding( trigger: Element, ev: Event | null ): Binding {
	const bind = trigger.getAttribute( 'os-bind' );
	const action = trigger.getAttribute( 'os-action' ) ?? 'set';
	const eventType = ev ? ev.type : eventFor( trigger );

	const explicitDebounce = trigger.getAttribute( 'os-debounce' );
	let debounce = 0;
	if ( explicitDebounce !== null ) {
		debounce = Math.max( 0, parseInt( explicitDebounce, 10 ) || 0 );
	} else if ( CONTINUOUS_EVENTS.has( eventType ) ) {
		debounce = DEFAULT_DEBOUNCE;
	}

	return {
		action,
		args: { ...attributeArgs( trigger ), ...( ev ? eventArgs( ev, trigger ) : {} ) },
		bind: bind && bind !== '' ? bind : null,
		debounce,
		confirm: confirmSpec( trigger ),
	};
}

/** One `os-poll` declaration. */
export interface PollSpec {
	key: string;
	action: string;
	args: Record< string, unknown >;
	intervalMs: number;
}

/** Every `[os-poll]` inside `root`, deduplicated by action + args. */
export function readPolls( root: Element ): PollSpec[] {
	const out = new Map< string, PollSpec >();
	for ( const el of Array.from( root.querySelectorAll( '[os-poll]' ) ) ) {
		const intervalMs = parseInt( el.getAttribute( 'os-poll' ) ?? '', 10 );
		const action = el.getAttribute( 'os-action' );
		if ( ! action || ! Number.isFinite( intervalMs ) || intervalMs < 250 ) {
			continue;
		}
		const args = attributeArgs( el );
		const key = `${ action }|${ intervalMs }|${ JSON.stringify( args ) }`;
		if ( ! out.has( key ) ) {
			out.set( key, { key, action, args, intervalMs } );
		}
	}
	return Array.from( out.values() );
}

/** `os-prop-foo` → `foo`; `os-prop-row-height` → `rowHeight`. */
export function propName( attributeName: string ): string {
	return attributeName
		.slice( 'os-prop-'.length )
		.replace( /-([a-z])/g, ( _m, c: string ) => c.toUpperCase() );
}

/**
 * Assign every `os-prop-*` attribute in `root` to its element as a
 * parsed property. Returns how many assignments were made; unchanged
 * attribute values are skipped via `seen`.
 */
export function applyProps( root: Element, seen: WeakMap< Element, Record< string, string > > ): number {
	let applied = 0;
	for ( const el of Array.from( root.querySelectorAll( '*' ) ) ) {
		let last = seen.get( el );
		for ( const attr of Array.from( el.attributes ) ) {
			if ( ! attr.name.startsWith( 'os-prop-' ) ) {
				continue;
			}
			if ( last && last[ attr.name ] === attr.value ) {
				continue;
			}
			let value: unknown = attr.value;
			try {
				value = JSON.parse( attr.value );
			} catch {
				// A bare string is a valid property value too.
			}
			( el as unknown as Record< string, unknown > )[ propName( attr.name ) ] = value;
			if ( ! last ) {
				last = {};
				seen.set( el, last );
			}
			last[ attr.name ] = attr.value;
			applied++;
		}
	}
	return applied;
}
