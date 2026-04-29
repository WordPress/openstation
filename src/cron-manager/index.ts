/**
 * Desktop Mode - Cron Manager window.
 *
 * @since 0.22.0
 */

import { __, sprintf } from '../i18n';
import {
	createEvent,
	deleteEvent,
	fetchEvents,
	fetchSchedules,
	runEventNow,
	updateEvent,
	type CronEvent,
	type CronEventPayload,
	type CronSchedule,
} from './rest';

import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const ROOT = '[data-wpdm-cron-manager-root]';
const SEARCH = '[data-wpdm-cron-manager-search]';
const FILTER = '[data-wpdm-cron-manager-schedule-filter]';
const FEEDBACK = '[data-wpdm-cron-manager-feedback]';
const REFRESH = '[data-wpdm-cron-manager-refresh]';
const CREATE = '[data-wpdm-cron-manager-create]';
const TABLE = '[data-wpdm-cron-manager-table]';
const EDITOR = '[data-wpdm-cron-manager-editor]';
const EDITOR_TITLE = '[data-wpdm-cron-manager-editor-title]';
const CLOSE_EDITOR = '[data-wpdm-cron-manager-close-editor]';
const CUSTOM_SCHEDULE = '[data-wpdm-cron-manager-custom-schedule]';
const NOTICE = '[data-wpdm-cron-manager-notice]';
const SAVE = '[data-wpdm-cron-manager-save]';
const CANCEL = '[data-wpdm-cron-manager-cancel]';
const DELETE = '[data-wpdm-cron-manager-delete]';

interface CronManagerState {
	events: CronEvent[];
	schedules: CronSchedule[];
	search: string;
	filter: string;
	editing: CronEvent | null;
	loadSeq: number;
}

type FieldName =
	| 'hook'
	| 'timestamp'
	| 'schedule'
	| 'customSlug'
	| 'customInterval'
	| 'customDisplay'
	| 'args';

interface FieldElements {
	hook: HTMLElement | null;
	timestamp: HTMLInputElement | null;
	schedule: HTMLElement | null;
	customSlug: HTMLElement | null;
	customInterval: HTMLElement | null;
	customDisplay: HTMLElement | null;
	args: HTMLTextAreaElement | null;
}

const CUSTOM_VALUE = '__custom';
const SINGLE_FILTER = '__single';
const feedbackTimers = new WeakMap< HTMLElement, number >();

function buildColumns(
	onEdit: ( event: CronEvent ) => void,
	onDelete: ( event: CronEvent ) => void,
	onRunNow: ( event: CronEvent ) => void,
): WpdTableColumn< CronEvent >[] {
	return [
		{
			key: 'hook',
			label: __( 'Hook' ),
			sortable: true,
			filter: 'text',
			render: ( _v, row ) => renderHookCell( row ),
		},
		{
			key: 'timestamp',
			label: __( 'Next run' ),
			sortable: true,
			width: '180px',
			sortValue: ( row ) => row.timestamp,
			render: ( _v, row ) => renderNextRun( row ),
		},
		{
			key: 'schedule',
			label: __( 'Recurrence' ),
			sortable: true,
			width: '150px',
			render: ( _v, row ) => row.scheduleDisplay,
		},
		{
			key: 'argsSummary',
			label: __( 'Args' ),
			width: '220px',
			render: ( _v, row ) => renderArgsCell( row ),
		},
		{
			key: 'due',
			label: __( 'Status' ),
			sortable: true,
			width: '110px',
			sortValue: ( row ) => statusOrder( row ),
			render: ( _v, row ) => renderStatus( row ),
		},
		{
			key: '__actions',
			label: '',
			width: '142px',
			align: 'end',
			render: ( _v, row ) => {
				const wrap = document.createElement( 'span' );
				wrap.style.cssText =
					'display:inline-flex;gap:4px;align-items:center;justify-content:flex-end;white-space:nowrap;';
				wrap.append(
					makeRowButton( __( 'Edit' ), () => onEdit( row ) ),
					makeRowButton( __( 'Run now' ), () => onRunNow( row ) ),
					makeRowButton( __( 'Delete' ), () => onDelete( row ), true ),
				);
				return wrap;
			},
		},
	];
}

function renderHookCell( row: CronEvent ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;gap:3px;min-width:0;';

	const hook = document.createElement( 'span' );
	hook.style.cssText =
		'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;';
	hook.textContent = row.hook;
	hook.title = row.hook;
	wrap.appendChild( hook );

	const meta = document.createElement( 'span' );
	meta.style.cssText = 'font-size:12px;color:#646970;';
	if ( row.callbackCount > 0 ) {
		meta.textContent = sprintf(
			/* translators: %d: callback count. */
			__( '%d callback(s)' ),
			row.callbackCount,
		);
	} else {
		meta.textContent = __( 'No registered callback' );
	}
	wrap.appendChild( meta );

	return wrap;
}

function renderNextRun( row: CronEvent ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;gap:3px;white-space:nowrap;';
	const local = document.createElement( 'span' );
	local.textContent = row.nextRunLocal;
	const rel = document.createElement( 'wpd-relative-time' );
	rel.setAttribute( 'datetime', row.nextRunGmt );
	rel.style.cssText = 'font-size:12px;color:#646970;';
	wrap.append( local, rel );
	return wrap;
}

function renderArgsCell( row: CronEvent ): HTMLElement {
	const text = document.createElement( 'span' );
	text.style.cssText =
		'display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
	text.textContent = row.argsSummary;
	text.title = row.argsSummary;
	return text;
}

function renderStatus( row: CronEvent ): HTMLElement {
	const badge = document.createElement( 'span' );
	let label = __( 'Scheduled' );
	let color = '#0a7f49';
	let bg = '#edfaef';
	if ( row.overdue ) {
		label = __( 'Overdue' );
		color = '#b32d2e';
		bg = '#fcf0f1';
	} else if ( row.due ) {
		label = __( 'Due' );
		color = '#8a6d1d';
		bg = '#fff8e5';
	}
	badge.textContent = label;
	badge.style.cssText = [
		'display:inline-flex',
		'align-items:center',
		'height:22px',
		'padding:0 8px',
		'border-radius:999px',
		'font-size:12px',
		'font-weight:600',
		`color:${ color }`,
		`background:${ bg }`,
	].join( ';' );
	return badge;
}

function statusOrder( row: CronEvent ): number {
	if ( row.overdue ) {
		return 0;
	}
	if ( row.due ) {
		return 1;
	}
	return 2;
}

function makeRowButton(
	label: string,
	onClick: () => void,
	danger = false,
): HTMLButtonElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.textContent = label;
	btn.setAttribute( 'data-noclick', '' );
	btn.style.cssText = [
		'height:28px',
		'padding:0 8px',
		'border:1px solid ' + ( danger ? '#d63638' : '#c3c4c7' ),
		'border-radius:6px',
		'background:#fff',
		'color:' + ( danger ? '#d63638' : '#1d2327' ),
		'font:inherit',
		'font-size:12px',
		'cursor:pointer',
	].join( ';' );
	btn.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		onClick();
	} );
	return btn;
}

export function renderCronManager( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >( ROOT );
	const table = body.querySelector< WpdTable< CronEvent > >( TABLE );
	const editor = body.querySelector< HTMLElement >( EDITOR );
	if ( ! root || ! table || ! editor ) {
		return;
	}

	const state: CronManagerState = {
		events: [],
		schedules: [],
		search: '',
		filter: '',
		editing: null,
		loadSeq: 0,
	};

	const fields = getFields( editor );

	table.columns = buildColumns(
		( event ) => openEditor( root, editor, fields, state, event ),
		( event ) => void handleDelete( table, state, event ),
		( event ) => void handleRunNow( table, state, root, event ),
	);
	table.getRowId = ( row ) => row.id;
	table.sort = { key: 'timestamp', direction: 'asc' };

	const render = (): void => {
		table.data = filterEvents( state );
	};

	root.querySelector( SEARCH )?.addEventListener( 'wpd-input-change', ( e ) => {
		state.search =
			( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		render();
	} );

	root.querySelector( FILTER )?.addEventListener( 'wpd-pick', ( e ) => {
		state.filter =
			( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		render();
	} );

	fields.schedule?.addEventListener( 'wpd-pick', ( e ) => {
		const value =
			( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		toggleCustomSchedule( editor, value === CUSTOM_VALUE );
	} );

	root.addEventListener( 'click', ( e ) => {
		const target = e.target as HTMLElement | null;
		if ( ! target ) {
			return;
		}
		if ( target.closest( REFRESH ) ) {
			void load( table, state, root );
			return;
		}
		if ( target.closest( CREATE ) ) {
			openEditor( root, editor, fields, state, null );
			return;
		}
		if ( target.closest( CLOSE_EDITOR ) || target.closest( CANCEL ) ) {
			closeEditor( root, editor, state );
			return;
		}
		if ( target.closest( SAVE ) ) {
			void handleSave( table, state, root, editor, fields );
			return;
		}
		if ( target.closest( DELETE ) && state.editing ) {
			void handleDelete( table, state, state.editing );
		}
	} );

	table.addEventListener( 'wpd-table-row-click', ( e: Event ) => {
		const row = ( e as CustomEvent< { row?: CronEvent } > ).detail?.row;
		if ( row ) {
			openEditor( root, editor, fields, state, row );
		}
	} );

	void load( table, state, root );
}

async function load(
	table: WpdTable< CronEvent >,
	state: CronManagerState,
	root: HTMLElement,
): Promise< void > {
	const seq = ++state.loadSeq;
	table.toggleAttribute( 'loading', true );
	setRootNotice( root, '' );
	try {
		const [ schedules, events ] = await Promise.all( [
			fetchSchedules(),
			fetchEvents(),
		] );
		if ( seq !== state.loadSeq ) {
			return;
		}
		state.schedules = schedules.schedules;
		state.events = events.events;
		populateFilter( root, state );
		const editor = root.querySelector< HTMLElement >( EDITOR );
		if ( editor ) {
			populateScheduleSelect( editor, state, '' );
		}
		table.data = filterEvents( state );
	} catch ( err ) {
		if ( seq === state.loadSeq ) {
			console.error( '[cron-manager] load failed', err );
			setRootNotice( root, ( err as Error ).message || String( err ) );
			table.data = [];
		}
	} finally {
		if ( seq === state.loadSeq ) {
			table.toggleAttribute( 'loading', false );
		}
	}
}

function filterEvents( state: CronManagerState ): CronEvent[] {
	const q = state.search.trim().toLowerCase();
	return state.events.filter( ( event ) => {
		if ( state.filter === SINGLE_FILTER && event.schedule !== '' ) {
			return false;
		}
		if (
			state.filter &&
			state.filter !== SINGLE_FILTER &&
			event.schedule !== state.filter
		) {
			return false;
		}
		if ( ! q ) {
			return true;
		}
		return [
			event.hook,
			event.schedule,
			event.scheduleDisplay,
			event.argsSummary,
		]
			.join( ' ' )
			.toLowerCase()
			.includes( q );
	} );
}

function populateFilter( root: HTMLElement, state: CronManagerState ): void {
	const select = root.querySelector< HTMLElement >( FILTER );
	if ( ! select ) {
		return;
	}
	select.innerHTML =
		`<wpd-option value="">${ escapeHtml( __( 'All schedules' ) ) }</wpd-option>` +
		`<wpd-option value="${ SINGLE_FILTER }">${ escapeHtml( __( 'One time' ) ) }</wpd-option>` +
		state.schedules
			.map(
				( s ) =>
					`<wpd-option value="${ escapeAttr( s.slug ) }">${ escapeHtml(
						s.display,
					) }</wpd-option>`,
			)
			.join( '' );
	setControlValue( select, state.filter );
}

function populateScheduleSelect(
	editor: HTMLElement,
	state: CronManagerState,
	value: string,
): void {
	const select = editor.querySelector< HTMLElement >(
		'[data-wpdm-cron-manager-field="schedule"]',
	);
	if ( ! select ) {
		return;
	}
	select.innerHTML =
		`<wpd-option value="">${ escapeHtml( __( 'One time' ) ) }</wpd-option>` +
		state.schedules
			.map(
				( s ) =>
					`<wpd-option value="${ escapeAttr( s.slug ) }">${ escapeHtml(
						s.display,
					) } (${ s.interval }s)</wpd-option>`,
			)
			.join( '' ) +
		`<wpd-option value="${ CUSTOM_VALUE }">${ escapeHtml(
			__( 'Custom interval' ),
		) }</wpd-option>`;
	setControlValue( select, value );
	toggleCustomSchedule( editor, value === CUSTOM_VALUE );
}

function openEditor(
	root: HTMLElement,
	editor: HTMLElement,
	fields: FieldElements,
	state: CronManagerState,
	event: CronEvent | null,
): void {
	state.editing = event;
	root.classList.add( 'wpdm-cron-manager--editing' );
	editor.hidden = false;
	setEditorNotice( editor, '' );

	const title = editor.querySelector< HTMLElement >( EDITOR_TITLE );
	if ( title ) {
		title.textContent = event ? __( 'Edit cron job' ) : __( 'Create cron job' );
	}

	populateScheduleSelect( editor, state, event?.schedule ?? '' );
	setControlValue( fields.hook, event?.hook ?? '' );
	setInputValue(
		fields.timestamp,
		toDatetimeLocal( event?.timestamp ?? Math.ceil( Date.now() / 1000 ) + 300 ),
	);
	setControlValue( fields.customSlug, '' );
	setControlValue( fields.customInterval, '300' );
	setControlValue( fields.customDisplay, '' );
	setTextareaValue( fields.args, event?.argsJson || '[]' );

	if ( fields.args ) {
		fields.args.disabled = event?.argsEditable === false;
	}
	if ( event?.argsEditable === false ) {
		setEditorNotice(
			editor,
			__(
				'This event has args that cannot be represented as JSON. You can change its hook, time, and recurrence; the original args will be preserved.',
			),
		);
	}

	const del = editor.querySelector< HTMLElement >( DELETE );
	if ( del ) {
		del.hidden = ! event;
	}
}

function closeEditor(
	root: HTMLElement,
	editor: HTMLElement,
	state: CronManagerState,
): void {
	state.editing = null;
	editor.hidden = true;
	root.classList.remove( 'wpdm-cron-manager--editing' );
	setEditorNotice( editor, '' );
}

async function handleSave(
	table: WpdTable< CronEvent >,
	state: CronManagerState,
	root: HTMLElement,
	editor: HTMLElement,
	fields: FieldElements,
): Promise< void > {
	setEditorNotice( editor, '' );
	let payload: CronEventPayload;
	try {
		payload = buildPayload( fields, state.editing );
	} catch ( err ) {
		setEditorNotice( editor, ( err as Error ).message || String( err ) );
		return;
	}

	table.toggleAttribute( 'loading', true );
	try {
		const result = state.editing
			? await updateEvent( state.editing.identity, payload )
			: await createEvent( payload );
		state.events = result.events;
		table.data = filterEvents( state );
		closeEditor( root, editor, state );
	} catch ( err ) {
		console.error( '[cron-manager] save failed', err );
		setEditorNotice( editor, ( err as Error ).message || String( err ) );
	} finally {
		table.toggleAttribute( 'loading', false );
	}
}

async function handleDelete(
	table: WpdTable< CronEvent >,
	state: CronManagerState,
	event: CronEvent,
): Promise< void > {
	// eslint-disable-next-line no-alert
	const ok = window.confirm(
		sprintf(
			/* translators: %s: cron hook. */
			__( 'Delete cron job "%s"?' ),
			event.hook,
		),
	);
	if ( ! ok ) {
		return;
	}

	table.toggleAttribute( 'loading', true );
	try {
		const result = await deleteEvent( event.identity );
		state.events = result.events;
		table.data = filterEvents( state );
	} catch ( err ) {
		console.error( '[cron-manager] delete failed', err );
		// eslint-disable-next-line no-alert
		window.alert( ( err as Error ).message || String( err ) );
	} finally {
		table.toggleAttribute( 'loading', false );
	}
}

async function handleRunNow(
	table: WpdTable< CronEvent >,
	state: CronManagerState,
	root: HTMLElement,
	event: CronEvent,
): Promise< void > {
	showFeedback(
		root,
		sprintf(
			/* translators: %s: cron hook. */
			__( 'Running "%s"…' ),
			event.hook,
		),
	);
	try {
		const result = await runEventNow( event.identity );
		state.events = result.events;
		table.data = filterEvents( state );
		showFeedback(
			root,
			sprintf(
				/* translators: %s: cron hook. */
				__( 'Ran "%s". Cron list refreshed.' ),
				event.hook,
			),
		);
	} catch ( err ) {
		console.error( '[cron-manager] run-now failed', err );
		showFeedback( root, ( err as Error ).message || String( err ), 'error' );
		// eslint-disable-next-line no-alert
		window.alert( ( err as Error ).message || String( err ) );
	}
}

function buildPayload(
	fields: FieldElements,
	editing: CronEvent | null,
): CronEventPayload {
	const hook = getControlValue( fields.hook ).trim();
	if ( ! hook ) {
		throw new Error( __( 'Hook is required.' ) );
	}

	const timestamp = parseDatetimeLocal( fields.timestamp?.value ?? '' );
	if ( timestamp <= 0 ) {
		throw new Error( __( 'Next run is required.' ) );
	}

	const scheduleValue = getControlValue( fields.schedule );
	const payload: CronEventPayload = {
		hook,
		timestamp,
		schedule: scheduleValue === CUSTOM_VALUE ? '' : scheduleValue,
	};

	if ( scheduleValue === CUSTOM_VALUE ) {
		const slug = getControlValue( fields.customSlug ).trim();
		const interval = Number( getControlValue( fields.customInterval ) );
		const display = getControlValue( fields.customDisplay ).trim();
		if ( ! slug ) {
			throw new Error( __( 'Custom schedule slug is required.' ) );
		}
		if ( ! Number.isFinite( interval ) || interval <= 0 ) {
			throw new Error( __( 'Custom interval must be greater than zero.' ) );
		}
		payload.customSchedule = { slug, interval, display };
	}

	if ( ! editing || editing.argsEditable ) {
		payload.args = parseArgs( fields.args?.value ?? '' );
	}

	return payload;
}

function parseArgs( raw: string ): unknown[] | Record< string, unknown > {
	const text = raw.trim();
	if ( ! text ) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse( text );
	} catch {
		throw new Error( __( 'Args must be valid JSON.' ) );
	}
	if ( ! Array.isArray( parsed ) && ! isPlainObject( parsed ) ) {
		throw new Error( __( 'Args must be a JSON array or object.' ) );
	}
	return parsed as unknown[] | Record< string, unknown >;
}

function isPlainObject( value: unknown ): value is Record< string, unknown > {
	return !! value && typeof value === 'object' && value.constructor === Object;
}

function getFields( editor: HTMLElement ): FieldElements {
	const field = ( name: FieldName ) =>
		editor.querySelector< HTMLElement >(
			`[data-wpdm-cron-manager-field="${ name }"]`,
		);
	return {
		hook: field( 'hook' ),
		timestamp: field( 'timestamp' ) as HTMLInputElement | null,
		schedule: field( 'schedule' ),
		customSlug: field( 'customSlug' ),
		customInterval: field( 'customInterval' ),
		customDisplay: field( 'customDisplay' ),
		args: field( 'args' ) as HTMLTextAreaElement | null,
	};
}

function toggleCustomSchedule( editor: HTMLElement, visible: boolean ): void {
	const custom = editor.querySelector< HTMLElement >( CUSTOM_SCHEDULE );
	if ( custom ) {
		custom.hidden = ! visible;
	}
}

function setRootNotice( root: HTMLElement, message: string ): void {
	const editor = root.querySelector< HTMLElement >( EDITOR );
	if ( editor ) {
		setEditorNotice( editor, message );
	}
}

function showFeedback(
	root: HTMLElement,
	message: string,
	type: 'success' | 'error' = 'success',
): void {
	const el = root.querySelector< HTMLElement >( FEEDBACK );
	if ( ! el ) {
		return;
	}
	const previous = feedbackTimers.get( root );
	if ( previous ) {
		window.clearTimeout( previous );
	}
	el.textContent = message;
	el.dataset.type = type;
	el.hidden = false;
	const timer = window.setTimeout( () => {
		el.hidden = true;
		feedbackTimers.delete( root );
	}, 4500 ) as unknown as number;
	feedbackTimers.set( root, timer );
}

function setEditorNotice( editor: HTMLElement, message: string ): void {
	const notice = editor.querySelector< HTMLElement >( NOTICE );
	if ( ! notice ) {
		return;
	}
	notice.textContent = message;
	notice.hidden = ! message;
}

function getControlValue( el: HTMLElement | null ): string {
	if ( ! el ) {
		return '';
	}
	const withValue = el as HTMLElement & { value?: string | number | null };
	if ( withValue.value !== undefined && withValue.value !== null ) {
		return String( withValue.value );
	}
	return el.getAttribute( 'value' ) ?? '';
}

function setControlValue( el: HTMLElement | null, value: string ): void {
	if ( ! el ) {
		return;
	}
	( el as HTMLElement & { value?: string } ).value = value;
	if ( value === '' ) {
		el.removeAttribute( 'value' );
	} else {
		el.setAttribute( 'value', value );
	}
}

function setInputValue( input: HTMLInputElement | null, value: string ): void {
	if ( input ) {
		input.value = value;
	}
}

function setTextareaValue(
	textarea: HTMLTextAreaElement | null,
	value: string,
): void {
	if ( textarea ) {
		textarea.value = value;
	}
}

function toDatetimeLocal( timestamp: number ): string {
	const d = new Date( timestamp * 1000 );
	const pad = ( n: number ) => String( n ).padStart( 2, '0' );
	return `${ d.getFullYear() }-${ pad( d.getMonth() + 1 ) }-${ pad(
		d.getDate(),
	) }T${ pad( d.getHours() ) }:${ pad( d.getMinutes() ) }`;
}

function parseDatetimeLocal( value: string ): number {
	if ( ! value ) {
		return 0;
	}
	const ms = new Date( value ).getTime();
	return Number.isFinite( ms ) ? Math.floor( ms / 1000 ) : 0;
}

function escapeHtml( value: string ): string {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&#039;' );
}

function escapeAttr( value: string ): string {
	return escapeHtml( value );
}

const registry =
	( window.wpDesktopNativeWindows ??
		( window.wpDesktopNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;

registry[ 'wpdm-cron-manager' ] = ( body: HTMLElement ) => {
	renderCronManager( body );
};
