const assert = require( 'node:assert/strict' );
const test = require( 'node:test' );

const kit = require( '../sdk/openstation-game-kit-0.1.1.js' );

test( '0.1.1 fixes manual accumulation without mutating frozen 0.1.0', () => {
	assert.equal( kit.VERSION, '0.1.1' );
} );

test( 'manual advance accumulates fractional fixed steps', () => {
	const updates = [];
	const renders = [];
	const loop = kit.createFixedStepLoop( {
		step: 0.01,
		update: ( dt ) => updates.push( dt ),
		render: ( alpha, elapsed ) => renders.push( { alpha, elapsed } ),
	} );

	loop.advance( 0.005 );
	assert.equal( updates.length, 0 );
	assert.equal( renders.at( -1 ).alpha, 0.5 );

	loop.advance( 0.005 );
	assert.deepEqual( updates, [ 0.01 ] );
	assert.equal( renders.at( -1 ).alpha, 0 );

	loop.advance( 0.02 );
	assert.deepEqual( updates, [ 0.01, 0.01, 0.01 ] );
	assert.equal( renders.at( -1 ).alpha, 0 );

	loop.dispose();
} );

test( 'pause and resume do not discard a manual advance remainder', () => {
	let updates = 0;
	const loop = kit.createFixedStepLoop( {
		step: 0.01,
		update: () => {
			updates += 1;
		},
	} );

	loop.advance( 0.004 );
	loop.pause();
	loop.resume();
	loop.pause();
	loop.advance( 0.006 );

	assert.equal( updates, 1 );
	loop.dispose();
} );
