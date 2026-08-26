const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );

const previous = require(
	'../games/popup-breaker/assets/popup-breaker-0.6.0.js'
);
const game = require(
	'../games/popup-breaker/assets/popup-breaker-0.6.1.js'
);
const root = path.resolve( __dirname, '..' );

function read( relativePath ) {
	return fs.readFileSync( path.join( root, relativePath ), 'utf8' );
}

test( '0.6.1 is a presentation-only patch over the frozen game', () => {
	assert.equal( game.ASSET_VERSION, '0.6.1' );
	assert.equal( game.RULES_VERSION, 2 );
	assert.equal( game.stepGame, previous.stepGame );
	assert.equal( game.createGame, previous.createGame );
	assert.equal( game.LEVELS, previous.LEVELS );
	assert.equal( game.levelForState, previous.levelForState );
	assert.equal( game.replayTip, previous.replayTip );
} );

test( 'the side-console type system has explicit readable targets', () => {
	const styles = read( 'standalone/popup-breaker-0.6.1.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.6.1.json'
		)
	);

	assert.equal( manifest.id, 'popup-siege-ui-system-0.6.1' );
	assert.equal( manifest.inherits, 'popup-siege-ui-system-0.6.0' );
	assert.deepEqual(
		manifest.typeTargetsAtCanonicalConsole.hudLabelCssPixels,
		[ 10, 12 ]
	);
	assert.deepEqual(
		manifest.typeTargetsAtCanonicalConsole.hudValueCssPixels,
		[ 15, 21 ]
	);
	assert.deepEqual(
		manifest.typeTargetsAtCanonicalConsole.controlLabelCssPixels,
		[ 9, 11 ]
	);
	assert.match( styles, /--siege-ui-type-hud-label/ );
	assert.match( styles, /--siege-ui-type-hud-value/ );
	assert.match( styles, /--siege-ui-type-control-label/ );
	assert.match( styles, /\.siege-game--legible-console-061/ );
	assert.match( styles, /@media \(forced-colors: active\)/ );
} );
