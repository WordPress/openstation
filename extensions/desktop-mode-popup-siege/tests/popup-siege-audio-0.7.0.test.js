const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );
const vm = require( 'node:vm' );

const sourcePath = path.resolve(
	__dirname,
	'../games/popup-breaker/assets/popup-siege-audio-0.7.0.js'
);
const source = fs.readFileSync( sourcePath, 'utf8' );

function createFakeEngine() {
	const calls = {
		duckMusic: [],
		enabled: [],
		ensureContext: 0,
		kicks: [],
		levels: [],
		noises: [],
		sequenceDispose: 0,
		sequencePause: 0,
		sequenceResume: 0,
		sequenceStart: [],
		sequenceStop: 0,
		suspend: 0,
		tones: [],
		dispose: 0,
	};
	const context = {
		currentTime: 8,
		state: 'running',
		suspend() {
			calls.suspend += 1;
			this.state = 'suspended';
			return Promise.resolve();
		},
	};
	let sequenceConfiguration = null;
	let running = false;
	let step = 0;
	const sequencer = {
		start( reset ) {
			calls.sequenceStart.push( Boolean( reset ) );
			if ( reset ) {
				step = 0;
			}
			running = true;
			return true;
		},
		pause() {
			if ( running ) {
				calls.sequencePause += 1;
			}
			running = false;
		},
		resume() {
			if ( ! running ) {
				calls.sequenceResume += 1;
				running = true;
			}
			return running;
		},
		stop() {
			calls.sequenceStop += 1;
			running = false;
			step = 0;
		},
		dispose() {
			calls.sequenceDispose += 1;
			running = false;
		},
		get running() {
			return running;
		},
		get step() {
			return step;
		},
	};
	const engine = {
		context,
		ensureContext() {
			calls.ensureContext += 1;
			context.state = 'running';
			return context;
		},
		tone( specification ) {
			calls.tones.push( { ...specification } );
			return true;
		},
		noise( specification ) {
			calls.noises.push( { ...specification } );
			return true;
		},
		kick( specification ) {
			calls.kicks.push( { ...specification } );
			return true;
		},
		duckMusic( ...args ) {
			calls.duckMusic.push( args );
		},
		setEnabled( enabled ) {
			calls.enabled.push( Boolean( enabled ) );
		},
		setLevels( levels ) {
			calls.levels.push( { ...levels } );
		},
		createSequencer( configuration ) {
			sequenceConfiguration = configuration;
			return sequencer;
		},
		dispose() {
			calls.dispose += 1;
		},
	};

	return {
		calls,
		context,
		engine,
		sequencer,
		get sequenceConfiguration() {
			return sequenceConfiguration;
		},
		runStep( nextStep ) {
			step = nextStep;
			sequenceConfiguration.onStep( {
				step: nextStep,
				time: context.currentTime + 0.1,
				tone: engine.tone,
				noise: engine.noise,
				kick: engine.kick,
			} );
		},
	};
}

function loadApi( overrides = {} ) {
	const base =
		overrides.base ||
		{
			ASSET_VERSION: '0.7.0',
			WAVE_SCHEDULE: [ 1, 2, 3 ],
			mount() {
				throw new Error( 'No mount stub supplied.' );
			},
		};
	const audioKit =
		overrides.audioKit ||
		{
			createAudioEngine() {
				throw new Error( 'Tests inject an engine.' );
			},
		};
	const sandbox = {
		PopupBreaker: base,
		OpenStationAudioKit: audioKit,
		console,
		Promise,
	};
	sandbox.globalThis = sandbox;
	vm.runInNewContext( source, sandbox, {
		filename: sourcePath,
	} );
	return sandbox.PopupBreaker;
}

function playingState( overrides = {} ) {
	return {
		phase: 'playing',
		popupCloses: 0,
		waveIndex: 0,
		lives: 3,
		timeLeft: 70,
		balls: [ {} ],
		multiballTimer: 0,
		result: null,
		...overrides,
	};
}

test( 'audio state derives durable boss, pressure, and multiball density', () => {
	const api = loadApi();
	const state = api.derivePopupSiegeAudioState070( {
		phase: 'playing',
		closedPopupIds: [ 'one', 'two' ],
		waveIndex: 3,
		lives: 2,
		timeLeft: 12,
		balls: [ {}, {} ],
		multiballTimer: 5,
	} );

	assert.equal( state.popupCloses, 2 );
	assert.equal( state.boss, true );
	assert.equal( state.pressure, true );
	assert.equal( state.multiball, true );
	assert.equal( state.dense, true );
	assert.equal( api.deriveAudioState070, api.deriveMusicState );

	const clearedBoss = api.derivePopupSiegeAudioState070( {
		phase: 'playing',
		waveIndex: 3,
		objective: {
			currentId: 'archive-sweep',
			activeThreatId: null,
		},
	} );
	assert.equal( clearedBoss.boss, false );
} );

test( 'the 120 BPM audio clock reserves cue space in the dense mix', () => {
	const api = loadApi();
	const fake = createFakeEngine();
	const audio = api.createPopupSiegeAudio070( {
		engine: fake.engine,
		music: true,
		effects: false,
	} );

	audio.sync(
		playingState( {
			waveIndex: 3,
			timeLeft: 12,
			balls: [ {}, {} ],
			multiballTimer: 6,
		} )
	);

	assert.equal( fake.sequenceConfiguration.bpm, 120 );
	assert.equal( fake.sequenceConfiguration.stepsPerBeat, 4 );

	fake.calls.tones.length = 0;
	fake.calls.noises.length = 0;
	fake.calls.kicks.length = 0;
	fake.runStep( 6 );
	assert.equal( fake.calls.tones.length, 0 );
	assert.equal( fake.calls.noises.length, 0 );
	assert.equal( fake.calls.kicks.length, 0 );

	fake.runStep( 8 );
	assert.ok( fake.calls.tones.length > 0 );
	assert.ok(
		fake.calls.tones
			.filter( ( tone ) => tone.midi <= 52 )
			.every( ( tone ) => tone.midi >= 45 && tone.pan === 0 )
	);
	assert.ok(
		fake.calls.tones.every(
			( tone ) =>
				tone.pan === undefined ||
				( tone.pan >= -0.18 && tone.pan <= 0.18 )
		)
	);
	audio.dispose();
} );

test( 'Results pauses Music but its stinger remains on Effects', () => {
	const api = loadApi();
	const fake = createFakeEngine();
	const audio = api.createPopupSiegeAudio070( {
		engine: fake.engine,
		music: true,
		effects: true,
	} );

	audio.sync( playingState() );
	fake.calls.tones.length = 0;
	audio.sync(
		playingState( {
			phase: 'results',
			popupCloses: 4,
			result: 'rescued',
		} )
	);

	assert.equal( fake.sequencer.running, false );
	assert.equal( fake.calls.sequencePause, 1 );
	assert.equal( fake.calls.tones.length, 6 );
	assert.ok( fake.calls.tones.every( ( tone ) => tone.bus === 'sfx' ) );
	assert.ok( fake.calls.tones.every( ( tone ) => tone.send === 0 ) );
	audio.dispose();
} );

test( 'popup, wave, boss, life, and result stingers all use Effects', () => {
	const api = loadApi();
	const fake = createFakeEngine();
	const audio = api.createPopupSiegeAudio070( {
		engine: fake.engine,
		music: true,
		effects: true,
	} );
	let state = playingState( {
		objective: {
			currentId: 'download-trap',
			activeThreatId: null,
		},
	} );
	audio.sync( state );

	const assertEffectsCue = ( nextState, label ) => {
		fake.calls.tones.length = 0;
		audio.sync( nextState );
		assert.ok( fake.calls.tones.length > 0, label );
		assert.ok(
			fake.calls.tones.every( ( tone ) => tone.bus === 'sfx' ),
			label
		);
		state = nextState;
	};

	assertEffectsCue(
		{
			...state,
			popupCloses: 1,
		},
		'popup'
	);
	assertEffectsCue(
		{
			...state,
			waveIndex: 1,
		},
		'wave'
	);
	assertEffectsCue(
		{
			...state,
			objective: {
				currentId: 'malware-boss',
				activeThreatId: 'malware-boss',
			},
		},
		'boss'
	);
	assertEffectsCue(
		{
			...state,
			lives: 2,
		},
		'life'
	);
	assertEffectsCue(
		{
			...state,
			phase: 'results',
			result: 'rescued',
		},
		'result'
	);
	audio.dispose();
} );

test( 'all four Music and Effects combinations have honest ownership', () => {
	const api = loadApi();
	const combinations = [
		{ music: true, effects: true },
		{ music: true, effects: false },
		{ music: false, effects: true },
		{ music: false, effects: false },
	];

	for ( const combination of combinations ) {
		const fake = createFakeEngine();
		const audio = api.createPopupSiegeAudio070( {
			engine: fake.engine,
			...combination,
		} );
		assert.deepEqual( fake.calls.levels.at( -1 ), {
			music: combination.music ? 0.1 : 0,
			sfx: combination.effects ? 0.28 : 0,
		} );
		audio.sync( playingState() );
		const musicStarted = fake.calls.sequenceStart.length > 0;
		assert.equal( musicStarted, combination.music );

		fake.calls.tones.length = 0;
		audio.sync(
			playingState( {
				phase: 'results',
				popupCloses: 4,
				result: 'rescued',
			} )
		);
		assert.equal(
			fake.calls.tones.length > 0,
			combination.effects,
			JSON.stringify( combination )
		);
		assert.ok(
			fake.calls.tones.every( ( tone ) => tone.bus === 'sfx' )
		);
		audio.dispose();
	}
} );

test( 'hidden suspension is immediate and resume or restart starts once', async () => {
	const api = loadApi();
	const fake = createFakeEngine();
	const audio = api.createPopupSiegeAudio070( {
		engine: fake.engine,
		music: true,
		effects: false,
	} );

	audio.sync( playingState() );
	assert.deepEqual( fake.calls.sequenceStart, [ true ] );

	audio.setEnvironmentSuspended( true );
	audio.setEnvironmentSuspended( true );
	await Promise.resolve();
	assert.equal( fake.calls.sequencePause, 1 );
	assert.equal( fake.calls.suspend, 1 );

	audio.setEnvironmentSuspended( false );
	audio.setEnvironmentSuspended( false );
	assert.equal( fake.calls.sequenceResume, 1 );

	audio.sync( playingState( { phase: 'paused' } ) );
	audio.sync( playingState() );
	audio.sync( playingState() );
	assert.equal( fake.calls.sequenceResume, 2 );

	audio.sync(
		playingState( {
			phase: 'results',
			result: 'overrun',
		} )
	);
	audio.sync( playingState() );
	audio.sync( playingState() );
	assert.deepEqual( fake.calls.sequenceStart, [ true, true ] );
	audio.dispose();
} );

class FakeEventTarget {
	constructor() {
		this.listeners = new Map();
	}

	addEventListener( type, listener ) {
		if ( ! this.listeners.has( type ) ) {
			this.listeners.set( type, new Set() );
		}
		this.listeners.get( type ).add( listener );
	}

	removeEventListener( type, listener ) {
		this.listeners.get( type )?.delete( listener );
	}

	emit( type, event = {} ) {
		for ( const listener of [ ...( this.listeners.get( type ) || [] ) ] ) {
			listener( event );
		}
	}

	listenerCount() {
		return [ ...this.listeners.values() ].reduce(
			( total, listeners ) => total + listeners.size,
			0
		);
	}
}

class FakeButton {
	constructor( action ) {
		this.dataset = { action };
		this.attributes = {};
		this.textContent = '';
	}

	closest() {
		return this;
	}

	setAttribute( name, value ) {
		this.attributes[ name ] = String( value );
	}
}

test( 'mount disables legacy audio, unlocks on pointer, subscribes, and disposes', () => {
	const fake = createFakeEngine();
	const window = new FakeEventTarget();
	const document = new FakeEventTarget();
	const container = new FakeEventTarget();
	const musicButton = new FakeButton( 'sound' );
	const effectsButton = new FakeButton( 'effects' );
	const startButton = new FakeButton( 'start' );
	const stage = { closest: () => null };
	const root = {
		dataset: {},
		querySelector( selector ) {
			if ( selector === '[data-action="sound"]' ) {
				return musicButton;
			}
			if ( selector === '[data-action="effects"]' ) {
				return effectsButton;
			}
			return null;
		},
		contains( node ) {
			return [ musicButton, effectsButton, startButton, stage ].includes(
				node
			);
		},
	};
	let mountedOptions = null;
	let subscriptionCount = 0;
	let unsubscribeCount = 0;
	let controllerTeardownCount = 0;
	const controller = {
		getState: () => ( { phase: 'menu', lives: 3 } ),
		subscribe() {
			subscriptionCount += 1;
			return () => {
				unsubscribeCount += 1;
			};
		},
		teardown() {
			controllerTeardownCount += 1;
		},
	};
	const base = {
		ASSET_VERSION: '0.7.0',
		WAVE_SCHEDULE: [ 1, 2, 3 ],
		mount( passedContainer, options ) {
			assert.equal( passedContainer, container );
			mountedOptions = options;
			return controller;
		},
	};
	const api = loadApi( { base } );

	window.setTimeout = () => {
		throw new Error( 'subscription path must not poll' );
	};
	window.clearTimeout = () => {};
	document.defaultView = window;
	document.hidden = false;
	container.ownerDocument = document;
	container.querySelector = ( selector ) =>
		selector === '.siege-game' ? root : null;

	const mounted = api.mount( container, {
		audioEngine: fake.engine,
		music: true,
		effects: true,
		sound: true,
	} );

	assert.equal( mountedOptions.sound, false );
	assert.equal( mountedOptions.music, false );
	assert.equal( mountedOptions.effects, false );
	assert.equal( subscriptionCount, 1 );

	container.emit( 'pointerdown', { target: stage } );
	assert.equal( fake.calls.ensureContext, 1 );

	let prevented = 0;
	let stopped = 0;
	container.emit( 'click', {
		target: musicButton,
		preventDefault() {
			prevented += 1;
		},
		stopImmediatePropagation() {
			stopped += 1;
		},
	} );
	assert.equal( prevented, 1 );
	assert.equal( stopped, 1 );
	assert.equal( musicButton.attributes[ 'aria-pressed' ], 'false' );
	assert.equal( musicButton.dataset.audioOwner, 'popup-siege-070' );

	mounted.teardown();
	mounted.teardown();
	assert.equal( unsubscribeCount, 1 );
	assert.equal( fake.calls.sequenceDispose, 1 );
	assert.equal( fake.calls.dispose, 1 );
	assert.equal( controllerTeardownCount, 1 );
	assert.equal( container.listenerCount(), 0 );
	assert.equal( document.listenerCount(), 0 );
	assert.equal( window.listenerCount(), 0 );
} );

test( 'the compatibility poll is bounded, absent with subscribe, and cleared', () => {
	const fake = createFakeEngine();
	const window = new FakeEventTarget();
	const document = new FakeEventTarget();
	const container = new FakeEventTarget();
	const timeoutDelays = [];
	const clearedTimers = [];
	const root = {
		dataset: {},
		querySelector: () => null,
		contains: () => true,
	};
	const controller = {
		getState: () => ( { phase: 'menu', lives: 3 } ),
		teardown() {},
	};
	const api = loadApi( {
		base: {
			ASSET_VERSION: '0.7.0',
			WAVE_SCHEDULE: [ 1, 2, 3 ],
			mount: () => controller,
		},
	} );

	window.setTimeout = ( callback, delay ) => {
		assert.equal( typeof callback, 'function' );
		timeoutDelays.push( delay );
		return 91;
	};
	window.clearTimeout = ( timer ) => clearedTimers.push( timer );
	document.defaultView = window;
	document.hidden = false;
	container.ownerDocument = document;
	container.querySelector = ( selector ) =>
		selector === '.siege-game' ? root : null;

	const mounted = api.mount( container, {
		audioEngine: fake.engine,
	} );
	assert.deepEqual( timeoutDelays, [ 100 ] );

	mounted.teardown();
	assert.deepEqual( clearedTimers, [ 91 ] );
	assert.equal( fake.calls.dispose, 1 );
} );

test( 'direct disposal is idempotent and closes the owned audio engine', () => {
	const api = loadApi();
	const fake = createFakeEngine();
	const audio = api.createPopupSiegeAudio070( {
		engine: fake.engine,
		music: true,
		effects: true,
	} );

	audio.dispose();
	audio.dispose();
	assert.equal( audio.disposed, true );
	assert.equal( fake.calls.sequenceDispose, 1 );
	assert.equal( fake.calls.dispose, 1 );
} );
