import { describe, expect, test, vi } from 'vitest';
import { MioSession } from '../../src/mio/assistant/session';
import { assertMioRequestBudget, mioBytes } from '../../src/mio/assistant/budget';
import { linkedMioHelp, searchMioHelp } from '../../src/mio/assistant/help';
import type { MioAbility, MioCallContext, MioTransport, MioTurn, MioTurnSummary, MioWindowContext } from '../../src/mio/assistant/types';

const done: MioTurn = { message: 'Done', calls: [] };
const call = ( name: string, args: unknown ) => ( { name, arguments: JSON.stringify( args ) } );
const failure = { ok: false as const, retryable: true, errors: [ { code: 'required', path: '$.fields[0].name', message: 'A field needs a name.', suggestion: 'Use customer_name.' } ] };
const context = ( abilities: MioAbility[], extra: Partial<MioWindowContext> = {} ): MioWindowContext => ( { host: document.body, title: 'Form', windowId: 'form-7', revision: () => 'r1', prompt: () => 'Edit the form', documents: [], abilities: () => abilities, ...extra } );
const ability = ( extra: Partial<MioAbility> = {} ): MioAbility => ( { name: 'save', effect: 'write', description: 'Save', parameters: { type: 'object' }, validate: () => true, run: ( _args, _signal, ctx ) => ( { effect: 'write', status: 'confirmed', receipt: ctx.callId } ), ...extra } );

function scripted( turns: MioTurn[] ) {
	return vi.fn<MioTransport>( async request => { assertMioRequestBudget( request ); return turns.shift() ?? done; } );
}

describe( 'recoverable validation', () => {
	test( 'two precise rejections lead to one successful write with one shared turn identity', async () => {
		const contexts: MioCallContext[] = [];
		const save = ability( { validate: ( args, ctx ) => { contexts.push( ctx! ); return args.name === 'valid' ? true : failure; }, run: vi.fn( () => ( { effect: 'write', status: 'confirmed', receipt: 'server-1' } ) ) } );
		const transport = scripted( [ ...[ 'bad', 'still bad', 'valid' ].map( name => ( { message: '', calls: [ call( 'save', { name } ) ] } ) ), done ] );
		const end = vi.fn();
		await new MioSession( context( [ save ], { onTurnEnd: end } ), transport, () => true ).ask( 'Fix it' );
		expect( save.run ).toHaveBeenCalledTimes( 1 );
		expect( JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes[ 0 ].result.errors[ 0 ].path ).toBe( '$.fields[0].name' );
		expect( new Set( contexts.map( ctx => ctx.turnId ) ).size ).toBe( 1 );
		expect( contexts.map( ctx => ctx.validationRemaining ) ).toEqual( [ 3, 2, 1 ] );
		expect( end ).toHaveBeenCalledWith( expect.objectContaining( { rejected: 2, confirmedWrites: 1, unknownWrites: 0, status: 'completed' } ) );
	} );

	test.each( [ '{broken', '[]', 'null' ] )( 'malformed envelope %s is repaired without running it', async argumentsText => {
		const save = ability( { run: vi.fn( () => ( { saved: true } ) ) } );
		const transport = scripted( [ { message: '', calls: [ { name: 'save', arguments: argumentsText } ] }, { message: '', calls: [ call( 'save', {} ) ] }, done ] );
		await new MioSession( context( [ save ] ), transport, () => true ).ask( 'Save' );
		expect( save.run ).toHaveBeenCalledTimes( 1 );
		expect( JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes[ 0 ].result.effect ).toBe( 'none' );
	} );

	test( 'starting new edits cannot reset the per-user-turn rejection allowance', async () => {
		const start = ability( { name: 'begin_edit', effect: 'validate', run: vi.fn( () => ( { editId: crypto.randomUUID() } ) ) } );
		const save = ability( { validate: () => failure, run: vi.fn() } );
		const transport = vi.fn<MioTransport>( async () => ( { message: '', calls: [ call( 'begin_edit', {} ), call( 'save', {} ) ] } ) );
		const session = new MioSession( context( [ start, save ] ), transport, () => true );
		await expect( session.ask( 'Save' ) ).rejects.toThrow( 'validation retry budget' );
		expect( save.run ).not.toHaveBeenCalled();
		expect( start.run ).toHaveBeenCalledTimes( 3 );
		expect( session.conversation.read().at( -1 )?.text ).toContain( 'confirmed writes: 0' );
	} );

	test( 'explicit no-write semantic failures are feedback, not duplicate saves', async () => {
		const save = ability( { run: vi.fn( () => ( { effect: 'none', status: 'rejected', errors: failure.errors, retryable: true } ) ) } );
		const session = new MioSession( context( [ save ] ), async () => ( { message: '', calls: [ call( 'save', { yaml: 'bad' } ) ] } ), () => true );
		await expect( session.ask( 'Save' ) ).rejects.toThrow( 'validation retry budget' );
		expect( save.run ).toHaveBeenCalledTimes( 3 );
		expect( session.conversation.read().at( -1 )?.text ).toContain( 'rejected candidates: 3; confirmed writes: 0' );
	} );

	test( 'authorization failure is terminal and does not become feedback', async () => {
		const save = ability( { allowed: () => false, run: vi.fn() } );
		const transport = scripted( [ { message: '', calls: [ call( 'save', {} ) ] } ] );
		await expect( new MioSession( context( [ save ] ), transport, () => true ).ask( 'Save' ) ).rejects.toThrow( 'unavailable' );
		expect( save.run ).not.toHaveBeenCalled(); expect( transport ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'run exceptions and unknown writes never enter a repair loop', async () => {
		for ( const run of [ vi.fn( () => { throw new Error( 'Connection lost' ); } ), vi.fn( () => ( { effect: 'write', status: 'unknown' } ) ) ] ) {
			const transport = scripted( [ { message: '', calls: [ call( 'save', {} ) ] } ] );
			const session = new MioSession( context( [ ability( { run } ) ] ), transport, () => true );
			await expect( session.ask( 'Save' ) ).rejects.toThrow();
			expect( transport ).toHaveBeenCalledTimes( 1 );
			expect( session.conversation.read().at( -1 )?.text ).toContain( 'unknown write outcomes: 1' );
		}
	} );
} );

describe( 'read and write accounting', () => {
	test( 'reads can refresh after a write and cannot loop indefinitely', async () => {
		let revision = 0;
		const read = ability( { name: 'read', effect: 'read', run: vi.fn( () => ( { revision } ) ) } );
		const save = ability( { run: () => { revision++; return { saved: true }; } } );
		const transport = scripted( [ { message: '', calls: [ call( 'read', {} ), call( 'save', {} ), call( 'read', {} ) ] }, done ] );
		const session = new MioSession( context( [ read, save ] ), transport, () => true );
		await session.ask( 'Edit' );
		const results = JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes;
		expect( results[ 0 ].result.revision ).toBe( 0 ); expect( results[ 2 ].result.revision ).toBe( 1 );
		const loop = new MioSession( context( [ read ] ), async () => ( { message: '', calls: [ call( 'read', {} ) ] } ), () => true );
		await expect( loop.ask( 'Read' ) ).rejects.toThrow( 'repeated-read budget' );
	} );

	test( 'a receipt cannot be counted twice, including when results have different arguments', async () => {
		const save = ability( { run: () => ( { effect: 'write', status: 'confirmed', receipt: 'same-receipt' } ) } );
		const session = new MioSession( context( [ save ] ), scripted( [ { message: '', calls: [ call( 'save', { x: 1 } ), call( 'save', { x: 2 } ) ] } ] ), () => true );
		await expect( session.ask( 'Save' ) ).rejects.toThrow( 'duplicate write receipt' );
		expect( session.operations.list().filter( op => op.status === 'confirmed' ) ).toHaveLength( 1 );
	} );

	test( 'JSON property order cannot bypass write deduplication', async () => {
		const save = ability( { run: vi.fn( () => ( { saved: true } ) ) } );
		const session = new MioSession( context( [ save ] ), scripted( [ { message: '', calls: [ call( 'save', { a: 1, b: 2 } ), call( 'save', { b: 2, a: 1 } ) ] } ] ), () => true );
		await expect( session.ask( 'Save' ) ).rejects.toThrow( 'repeated an action' );
		expect( save.run ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'document history and budgets', () => {
	test( 'a 40 KB form survives two repairs and help reads without truncation or excess bytes', async () => {
		const documentText = JSON.stringify( { fields: Array.from( { length: 780 }, ( _, i ) => ( { id: i, label: `Field ${ i }`, value: '漢字\\"\\n' } ) ) } );
		expect( mioBytes( documentText ) ).toBeGreaterThan( 40000 );
		const read = ability( { name: 'read_form', effect: 'read', run: () => ( { document: documentText } ) } );
		const seen: string[] = [];
		const save = ability( { effect: 'write', validate: args => { seen.push( args.document as string ); return args.name === 'valid' ? true : failure; }, run: vi.fn( () => ( { effect: 'write', status: 'confirmed', receipt: 'form-revision-2', data: { byteLength: mioBytes( documentText ) } } ) ), history: entry => ( { result: entry.result, editId: 'edit-1', documentHash: 'app-sha256', byteLength: mioBytes( documentText ) } ) } );
		const transport = scripted( [
			{ message: '', calls: [ call( 'read_form', {} ), call( 'read_help', { id: 'rules.md' } ) ] },
			...[ 'bad', 'still bad', 'valid' ].map( name => ( { message: '', calls: [ call( 'save', { name, document: documentText } ) ] } ) ),
			{ message: '', calls: [ call( 'read_form', {} ) ] }, done,
		] );
		await new MioSession( context( [ read, save ], { documents: [ { id: 'rules.md', title: 'Form rules', markdown: '# Rules\nAll fields must have names. ' + 'Follow schema. '.repeat( 200 ) } ], compactHistory: history => ( { ...history, outcomes: history.outcomes.filter( ( entry, index, entries ) => ( entry as { name: string } ).name !== 'read_form' || index === entries.findLastIndex( item => ( item as { name: string } ).name === 'read_form' ) ) } ) } ), transport, () => true ).ask( 'Edit form using rules' );
		expect( seen ).toEqual( [ documentText, documentText, documentText ] );
		expect( save.run ).toHaveBeenCalledTimes( 1 );
		for ( const [ request ] of transport.mock.calls ) {
			expect( mioBytes( request.transcript ) ).toBeLessThanOrEqual( 96000 );
			const reads = JSON.parse( request.transcript ).outcomes.filter( ( item: { name: string } ) => item.name === 'read_form' );
			for ( const item of reads ) { expect( item.result.document ).toBe( documentText ); }
		}
	} );

	test( 'UTF-8 and JSON escaping are measured before even a custom transport runs', async () => {
		const transport = vi.fn<MioTransport>();
		const session = new MioSession( context( [], { prompt: () => '漢'.repeat( 5400 ) } ), transport, () => true );
		await expect( session.ask( 'Read' ) ).rejects.toMatchObject( { code: 'mio_request_budget', scope: 'prompt', usedBytes: 16200, remainingBytes: 0 } );
		expect( transport ).not.toHaveBeenCalled();
		const request = { prompt: 'hello', transcript: '\\'.repeat( 95990 ), tools: [] };
		expect( () => assertMioRequestBudget( request ) ).not.toThrow();
		request.transcript = '漢'.repeat( 32001 );
		expect( () => assertMioRequestBudget( request ) ).toThrow( 'transcript budget' );
	} );
} );

describe( 'help precision and continuation', () => {
	test( 'exact component IDs beat common words and expose manifest metadata', () => {
		const docs = [ { id: 'common.md', title: 'The use of fields', markdown: '# Fields\nuse the fields' }, { id: 'kit.md', title: 'Date input', version: 'schema-r2', topics: [ 'forms' ], componentIds: [ 'os-date-picker' ], markdown: '# Date\n## Validation\nReject invalid dates.' } ];
		expect( searchMioHelp( docs, 'os-date-picker' )[ 0 ] ).toMatchObject( { id: 'kit.md', version: 'schema-r2', componentIds: [ 'os-date-picker' ] } );
		expect( searchMioHelp( docs, 'the use of' ) ).toEqual( [] );
	} );
	test( 'late rules are readable by section or cursor, and stale cursors fail clearly', () => {
		const markdown = '# Start\n' + 'x'.repeat( 16000 ) + '\n## Critical rule\nNever drop hidden fields.';
		const docs = [ { id: 'form.md', title: 'Form', markdown } ];
		const first = linkedMioHelp( docs, 'form.md' );
		expect( first.truncated ).toBe( true );
		expect( first.sections ).toContainEqual( { id: 'critical-rule', title: 'Critical rule' } );
		const next = linkedMioHelp( docs, 'form.md', undefined, first.cursor! );
		expect( first.markdown + next.markdown ).toBe( markdown );
		expect( next.truncated ).toBe( false );
		expect( linkedMioHelp( docs, 'form.md', 'critical-rule' ).markdown ).toContain( 'Never drop hidden fields' );
		expect( () => linkedMioHelp( [ { ...docs[ 0 ], markdown: `${ markdown } changed` } ], 'form.md', undefined, first.cursor! ) ).toThrow( 'stale' );
	} );
} );

test( 'cancelled saves retain identities for read-only reconciliation after disposal', async () => {
	let finish!: ( value: unknown ) => void;
	let callContext!: MioCallContext;
	const save = ability( { run: vi.fn( ( _args, _signal, ctx ) => { callContext = ctx; return new Promise( resolve => { finish = resolve; } ); } ) } );
	const begin = vi.fn(); const abort = vi.fn(); const end = vi.fn<( summary: MioTurnSummary ) => void>();
	const operationStatus = vi.fn( async () => ( { effect: 'write' as const, status: 'confirmed' as const, receipt: 'draft-123' } ) );
	const session = new MioSession( context( [ save ], { onTurnBegin: begin, onTurnAbort: abort, onTurnEnd: end, operationStatus } ), scripted( [ { message: '', calls: [ call( 'save', {} ) ] } ] ), () => true );
	const pending = session.ask( 'Create draft' );
	await vi.waitFor( () => expect( save.run ).toHaveBeenCalledTimes( 1 ) );
	expect( callContext ).toMatchObject( { windowId: 'form-7', revision: 'r1', idempotencyKey: callContext.callId } );
	session.dispose();
	expect( abort ).toHaveBeenCalledTimes( 1 );
	expect( session.operations.list()[ 0 ].status ).toBe( 'unknown' );
	const result = await session.operations.inspect( callContext.callId, new AbortController().signal );
	expect( result ).toMatchObject( { status: 'confirmed', receipt: 'draft-123' } );
	finish( { effect: 'write', status: 'confirmed', receipt: 'draft-123' } );
	await expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
	expect( begin ).toHaveBeenCalledTimes( 1 ); expect( end ).toHaveBeenCalledTimes( 1 );
	expect( session.conversation.read() ).toHaveLength( 0 );
	expect( save.run ).toHaveBeenCalledTimes( 1 );
	expect( operationStatus ).toHaveBeenCalledTimes( 1 );
} );

test( 'tool budgets mirror PHP Unicode escaping and the total budget includes JSON escaping', () => {
	const tools = [ { name: 'x', description: '漢'.repeat( 16000 ), parameters: { type: 'object' } } ];
	expect( () => assertMioRequestBudget( { prompt: 'p', transcript: '{}', tools } ) ).toThrow( 'tools budget' );
	const request = { prompt: '\\'.repeat( 15000 ), transcript: '\\'.repeat( 95000 ), tools: [ { name: 'x', description: 'a'.repeat( 1000 ), parameters: { type: 'object' } } ] };
	expect( () => assertMioRequestBudget( request ) ).toThrow( 'request budget' );
} );

test( 'an authoritative status receipt survives a late failed save response', async () => {
	let fail!: ( error: Error ) => void;
	const run = vi.fn( () => new Promise( ( _resolve, reject ) => { fail = reject; } ) );
	const session = new MioSession( context( [ ability( { run } ) ], { operationStatus: async () => ( { effect: 'write', status: 'confirmed', receipt: 'committed-1' } ) } ), scripted( [ { message: '', calls: [ call( 'save', {} ) ] } ] ), () => true );
	const pending = session.ask( 'Save' );
	await vi.waitFor( () => expect( run ).toHaveBeenCalled() );
	const id = session.operations.list()[ 0 ].callId;
	await session.operations.inspect( id, new AbortController().signal );
	session.cancel(); fail( new Error( 'Network lost the response' ) );
	await expect( pending ).rejects.toThrow();
	expect( session.operations.list()[ 0 ] ).toMatchObject( { status: 'confirmed', receipt: 'committed-1' } );
} );


test( 'semantic rejection history preserves compact resource metadata and mandatory errors', async () => {
	const reject = ability( { run: () => ( { effect: 'none', status: 'rejected', errors: failure.errors, retryable: true, data: { document: 'x'.repeat( 100000 ) } } ), history: () => ( { editId: 'draft-1', documentHash: 'sha256', byteLength: 100000 } ) } );
	const transport = scripted( [ { message: '', calls: [ call( 'save', {} ) ] }, done ] );
	await new MioSession( context( [ reject ] ), transport, () => true ).ask( 'Validate' );
	const outcome = JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes[ 0 ].result;
	expect( outcome ).toMatchObject( { effect: 'none', errors: failure.errors, data: { editId: 'draft-1', byteLength: 100000 } } );
	expect( transport.mock.calls[ 1 ][ 0 ].transcript ).not.toContain( 'x'.repeat( 1000 ) );
} );


test( 'an operation observer that closes the window cannot leave a write queued to run', async () => {
	const save = ability( { run: vi.fn() } );
	const session = new MioSession( context( [ save ], { onOperation: operation => { if ( operation.status === 'running' ) { session.cancel(); } } } ), scripted( [ { message: '', calls: [ call( 'save', {} ) ] } ] ), () => true );
	await expect( session.ask( 'Save' ) ).rejects.toMatchObject( { name: 'AbortError' } );
	expect( save.run ).not.toHaveBeenCalled();
	expect( session.operations.list()[ 0 ].status ).toBe( 'rejected' );
} );

describe( 'reviewed Unicode and terminal-validation boundaries', () => {
	test.each( [ '😀', '𠀀' ] )( 'search and help cursors never split the astral character %s', character => {
		const prefix = 'x'.repeat( 3199 );
		const search = searchMioHelp( [ { id: 'emoji.md', title: 'Emoji', markdown: prefix + character + 'tail' } ], 'emoji' )[ 0 ];
		expect( search.excerpt ).toBe( prefix ); expect( search.truncated ).toBe( true );
		for ( const section of [ undefined, 'rules' ] ) {
			const heading = '# Rules\n';
			const markdown = heading + 'x'.repeat( 11999 - heading.length ) + character + 'tail';
			const docs = [ { id: 'emoji.md', title: 'Emoji', markdown } ];
			const first = linkedMioHelp( docs, 'emoji.md', section );
			const second = linkedMioHelp( docs, 'emoji.md', section, first.cursor! );
			expect( first.markdown ).toHaveLength( 11999 );
			expect( second.markdown ).toBe( character + 'tail' );
			expect( first.markdown + second.markdown ).toBe( markdown );
			expect( second.cursor ).toBeNull();
		}
	} );

	test( 'astral characters cost four UTF-8 bytes and twelve bytes in the PHP-escaped tool catalog', () => {
		expect( mioBytes( '😀𠀀' ) ).toBe( 8 );
		const request = { prompt: '😀'.repeat( 4000 ), transcript: '{}', tools: [] };
		expect( () => assertMioRequestBudget( request ) ).not.toThrow();
		try { assertMioRequestBudget( { ...request, prompt: request.prompt + '😀' } ); throw new Error( 'Expected overflow' ); }
		catch ( error ) { expect( error ).toMatchObject( { scope: 'prompt', usedBytes: 16004, limitBytes: 16000 } ); }
		const tools = [ { name: 'x', description: '', parameters: { type: 'object' } } ];
		const room = 96000 - JSON.stringify( tools ).length;
		tools[ 0 ].description = '😀'.repeat( Math.floor( room / 12 ) ) + 'a'.repeat( room % 12 );
		expect( () => assertMioRequestBudget( { prompt: '', transcript: '', tools } ) ).not.toThrow();
		tools[ 0 ].description += '😀';
		try { assertMioRequestBudget( { prompt: '', transcript: '', tools } ); throw new Error( 'Expected overflow' ); }
		catch ( error ) { expect( error ).toMatchObject( { scope: 'tools', usedBytes: 96012, limitBytes: 96000 } ); }
	} );

	test.each( [ 0, 1 ] )( 'argument budget accepts exactly 96 KB and repairs a multibyte overflow (%i)', async extra => {
		const room = 96000 - JSON.stringify( { text: '' } ).length;
		const argumentsText = JSON.stringify( { text: '😀'.repeat( Math.floor( room / 4 ) + extra ) + 'a'.repeat( room % 4 ) } );
		expect( mioBytes( argumentsText ) ).toBe( 96000 + extra * 4 );
		expect( argumentsText.length ).toBeLessThan( 96000 );
		const save = ability( { validate: vi.fn( () => true ), run: vi.fn( () => ( { saved: true } ) ) } );
		const transport = scripted( [ { message: '', calls: [ { name: 'save', arguments: argumentsText } ] }, ...( extra ? [ { message: '', calls: [ call( 'save', { text: 'Small repaired candidate' } ) ] } ] : [] ), done ] );
		const session = new MioSession( context( [ save ] ), transport, () => true );
		await session.ask( 'Save' );
		expect( save.validate ).toHaveBeenCalledOnce(); expect( save.run ).toHaveBeenCalledOnce();
		if ( extra ) {
			const feedback = JSON.parse( transport.mock.calls[ 1 ][ 0 ].transcript ).outcomes[ 0 ].result;
			expect( feedback ).toMatchObject( { effect: 'none', retryable: true, errors: [ { code: 'argument_budget' } ] } );
			expect( session.operations.list().map( operation => operation.status ) ).toEqual( [ 'rejected', 'confirmed' ] );
		}
	} );

	test.each( [ 'validator', 'run' ] )( 'retryable:false is terminal in %s, including the rest of a chained batch', async phase => {
		const terminal = { ...failure, retryable: false };
		const save = ability( { validate: () => phase === 'validator' ? terminal : true, run: vi.fn( () => ( { effect: 'none', status: 'rejected', errors: terminal.errors, retryable: false } ) ) } );
		const later = ability( { name: 'later', run: vi.fn() } );
		const transport = scripted( [ { message: '', calls: [ call( 'save', {} ), call( 'later', {} ) ] }, done ] );
		const session = new MioSession( context( [ save, later ] ), transport, () => true );
		await expect( session.ask( 'Save' ) ).rejects.toThrow( 'validation is terminal' );
		expect( transport ).toHaveBeenCalledOnce(); expect( later.run ).not.toHaveBeenCalled();
		expect( save.run ).toHaveBeenCalledTimes( phase === 'validator' ? 0 : 1 );
		expect( session.operations.list().map( operation => operation.status ) ).toEqual( [ 'rejected' ] );
		expect( session.conversation.read().at( -1 )?.text ).toContain( 'confirmed writes: 0; unknown write outcomes: 0' );
	} );
} );
