# `wp.os.ai.ask()` — programmatic AI Copilot

Five-minute tour of the three shapes plugin authors reach for.

## 1. Just ask

```javascript
wp.os.ready( async () => {
    const res = await wp.os.ai.ask( 'where do I manage categories?' );
    console.log( res.answer_type );  // 'navigation'
    console.log( res.message );      // e.g. "Here's where you'll find them — Posts → Categories."
    console.log( res.admin_links );  // [ { title, url, description, icon }, … ]
} );
```

Same endpoint the built-in overlay uses. No JS framework required — plain `await`.

## 2. Use your slash-commands as AI tools

**Scenario:** A Home Assistant plugin registers `/turn_lights`. A chat plugin (or voice assistant, or automation) wants the AI to pick the command when the user says "turn on the lights."

### Register the command with `aiCallable: true`

```javascript
wp.os.ready( () => {
    wp.os.registerCommand( {
        slug:        'turn_lights',
        label:       'Turn lights on/off',
        description: 'Toggle smart lights connected to Home Assistant.',
        hint:        'ON or OFF',
        aiCallable:  true,             // ← opt-in: AI can invoke this
        owner:       'home-assistant-commands',
        run: async ( args ) => {
            const state = args.trim().toUpperCase();
            if ( state !== 'ON' && state !== 'OFF' ) {
                return `Usage: /turn_lights ON|OFF (got "${ args }")`;
            }
            await fetch( '/api/ha/lights', {
                method:  'POST',
                body:    JSON.stringify( { state } ),
                headers: { 'Content-Type': 'application/json' },
            } );
            return `Lights ${ state }.`;
        },
    } );
} );
```

### Ask with tools enabled

```javascript
const res = await wp.os.ai.ask( 'hey turn on the lights', {
    tools: 'aiCallable',
} );

// res.answer_type === 'tool_call'
// res.toolCall    === { slug: 'turn_lights', args: 'ON', result: 'Lights ON.' }
// res.message     === 'Lights ON.'   // string returns lift into message
```

### Get a natural-language reply, not just the raw `run()` string

Add `followUp: true`:

```javascript
const res = await wp.os.ai.ask( 'hey turn on the lights', {
    tools:    'aiCallable',
    followUp: true,
} );

// res.message === 'Done — your office light is on now. Anything else?'
// res.toolCall.result === 'Lights ON.'   // the raw run() return is preserved
```

One-shot mode (`followUp: false`, the default) sets `res.message` to whatever the command's `run()` returned. That's fine for short status strings, but if your command returns an object (`{ total: 42, breakdown: [...] }`) or if you're building a voice / chat surface that expects conversational replies, `followUp: true` lets the AI compose a sentence in the voice of your system prompt.

Cost: one extra provider round-trip per command invocation. Latency roughly doubles. For one-tap UI buttons, leave `followUp` off; for anything that talks back to the user, turn it on.

If the second leg fails (network, API), `ask()` does **not** throw — you get the one-shot `message` as a fallback and `res.toolCall.result` is preserved. The command ran regardless.

### Narrower allowlists

Pass an array of slugs or a predicate if you want only a subset offered to the model:

```javascript
// Only these three:
await wp.os.ai.ask( prompt, {
    tools: [ 'turn_lights', 'set_thermostat', 'play_music' ],
} );

// Or a predicate:
await wp.os.ai.ask( prompt, {
    tools: ( slug ) => slug.startsWith( 'ha_' ) && ! slug.endsWith( '_delete' ),
} );
```

Only commands with `aiCallable: true` are visible regardless — the option can narrow, never widen.

## 3. Custom system prompt

Give the AI domain context without touching PHP:

```javascript
await wp.os.ai.ask( 'is the kitchen light on?', {
    tools: 'aiCallable',
    systemPrompt:
        'You control a smart home. Rooms: kitchen, living room, bedroom, garage. ' +
        'Prefer the turn_lights / set_thermostat tools for commands; for status ' +
        'questions, use the get_state tool.',
} );
```

String = append. For a full replace (admin-only by default):

```javascript
await wp.os.ai.ask( 'status?', {
    systemPrompt: { mode: 'replace', text: 'Only reply in a single short sentence.' },
} );
```

Non-admin callers sending `mode: 'replace'` get a silent downgrade to append — text is never lost.

## 4. PHP-side: register a server-dispatched tool (WordPress ability)

When the tool's logic is inherently server-side (database lookups, WooCommerce, WP-CLI wrappers), skip the command path and register a [WordPress Ability](https://developer.wordpress.org/apis/abilities-api/). The Copilot offers the model every **read-only** ability on the site — its own built-ins plus yours — so there's just one step: register a read-only ability.

```php
add_action( 'wp_abilities_api_init', function () {
    wp_register_ability( 'my-plugin/list-recent-orders', array(
        'label'               => __( 'List recent orders', 'my-plugin' ),
        'description'         => 'Return the N most recent WooCommerce orders, newest first.',
        'category'            => 'openstation', // or your own registered category
        'input_schema'        => array(
            'type'                 => 'object',
            'additionalProperties' => false,
            'required'             => array( 'limit' ),
            'properties'           => array(
                'limit' => array(
                    'type'        => 'integer',
                    'description' => 'How many orders to return (1-20).',
                ),
            ),
        ),
        'output_schema'       => array( 'type' => 'object', 'additionalProperties' => true ),
        // Mark it read-only so the assistant offers it (only read-only
        // abilities are advertised — a search turn can be steered by
        // attacker-controlled content).
        'meta'                => array( 'annotations' => array( 'readonly' => true ) ),
        'permission_callback' => function () {
            return current_user_can( 'manage_woocommerce' );
        },
        'execute_callback'    => function ( $input ) {
            $limit  = min( 20, max( 1, (int) ( $input['limit'] ?? 5 ) ) );
            $orders = wc_get_orders( array( 'limit' => $limit ) );
            return array(
                'orders' => array_map( static function ( $o ) {
                    return array(
                        'id'     => $o->get_id(),
                        'status' => $o->get_status(),
                        'total'  => (float) $o->get_total(),
                    );
                }, $orders ),
            );
        },
    ) );
} );
```

No JS required, and no opt-in step. The agent loop advertises the ability to the model and dispatches calls through `wp_get_ability()->execute()`, so users without `manage_woocommerce` get a clean permission error instead of a result.

## 5. Observability

Every call is trace-able via three actions that share a `request_id`:

```php
add_action( 'open_station_ai_search_started', function ( $ctx ) {
    // { query, user_id, request_id }
    my_logger()->info( 'ai.started', $ctx );
} );

add_action( 'open_station_ai_tool_called', function ( $ctx ) {
    // { tool_name, args, user_id, request_id }
    my_logger()->debug( 'ai.tool', $ctx );
} );

add_action( 'open_station_ai_search_completed', function ( $ctx ) {
    // { query, user_id, request_id, answer_type, iterations, usage, model }
    // usage = { prompt, completion, total } tokens; model = { id, name } (or null).
    my_logger()->info( 'ai.completed', $ctx );
} );

add_action( 'open_station_ai_search_error', function ( $err ) {
    my_logger()->error( 'ai.error', $err );
} );
```

## 6. Cancel in-flight requests

```javascript
const controller = new AbortController();
const timeout = setTimeout( () => controller.abort(), 8000 );

try {
    const res = await wp.os.ai.ask( prompt, { signal: controller.signal } );
    console.log( res.message );
} catch ( err ) {
    if ( err instanceof DOMException && err.name === 'AbortError' ) {
        console.log( 'cancelled' );
    } else {
        throw err;
    }
} finally {
    clearTimeout( timeout );
}
```
