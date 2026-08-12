# AI Agents — extend and invoke from a plugin

**Status: Experimental.** The whole module sits behind the
`agents` extended option (OpenStation Preferences → Features → Extended options,
admin-only). While the flag is off none of these hooks or routes
exist — the one thing that stays is the WP Explorer **Agents** section,
which is always listed and renders read-only, with a way into the
Features tab for admins.

An agent is a login-blocked `wp_users` row whose definition
(description, system prompt, ability allowlist, triggers, model
override, rate limit) lives as user meta on that row. Full contract:
[Hooks Reference — AI Agents](../hooks-reference.md#ai-agents).

## Give agents a new tool

Agents pick their tools from the WordPress Abilities API — register an
ability and it appears in every agent's Tools picker automatically:

```php
add_action( 'wp_abilities_api_init', function () {
	wp_register_ability(
		'my-plugin/count-drafts',
		array(
			'label'               => __( 'Count drafts', 'my-plugin' ),
			'description'         => 'Count the current draft posts.',
			'category'            => 'my-plugin',
			'input_schema'        => array( 'type' => 'object', 'properties' => array() ),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array( 'drafts' => array( 'type' => 'integer' ) ),
			),
			'execute_callback'    => function () {
				return array( 'drafts' => (int) wp_count_posts()->draft );
			},
			// Evaluated against the AGENT user during a run.
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			// Truthful annotation — drives the read-only badge in the
			// picker (and offers the ability to the AI Copilot too).
			'meta'                => array(
				'annotations' => array( 'readonly' => true ),
			),
		)
	);
} );
```

The agent runs the tool **as itself**: the `permission_callback` sees
the agent's role, so an agent whose role lacks `edit_posts` cannot
call this even when it is on the allowlist.

## Invoke an agent server-side

```php
$agents = openstation_agent_get_agents();
if ( $agents ) {
	$result = openstation_agent_invoke(
		$agents[0]->ID,
		'Summarize the last comment on the site.',
		array( 'source' => 'my-plugin/cron' )
	);
	if ( ! is_wp_error( $result ) ) {
		// $result = array( 'text' => ..., 'toolCalls' => [...], 'turns' => N )
	}
}
```

Every successful run fires `openstation_agent_completed` with the
same result plus your context array.

## Audit every definition change

User meta has no revisions — these actions are the audit trail:

```php
add_action( 'openstation_agent_updated', function ( $agent_id, $changed, $actor_id ) {
	foreach ( $changed as $field => $delta ) {
		my_plugin_audit_log(
			sprintf(
				'Agent #%d %s changed by #%d: %s -> %s',
				$agent_id,
				$field,
				$actor_id,
				wp_json_encode( $delta['from'] ),
				wp_json_encode( $delta['to'] )
			)
		);
	}
}, 10, 3 );
```

`openstation_agent_created` and `openstation_agent_deleted` complete
the set.

## Declare a custom trigger kind

Trigger configuration is stored per-agent now; intakes beyond chat
arrive in later phases. Declaring a kind makes it configurable in the
Triggers pane today:

```php
add_filter( 'openstation_agent_trigger_kinds', function ( $kinds ) {
	$kinds[] = array(
		'slug'          => 'my-plugin-webhook',
		'label'         => __( 'My webhook', 'my-plugin' ),
		'description'   => __( 'Run when my-plugin receives a webhook.', 'my-plugin' ),
		'icon'          => 'dashicons-rest-api',
		'config_schema' => array(
			'type'       => 'object',
			'properties' => array(
				'event' => array( 'type' => 'string' ),
			),
		),
	);
	return $kinds;
} );
```

Read it back with `openstation_agent_get_triggers( $agent_id )` and
wire your own intake to `openstation_agent_invoke()`.

## Open a chat with an agent from JS

```js
wp.os.whenReady( () => {
	const store = wp.os.createSharedStore(
		'desktop-mode/agents-chat',
		() => ( { activeAgent: null, transcripts: {} } ),
	);
	store.state.activeAgent = {
		id: 12,
		name: 'Audit Agent',
		description: 'Audits drafts.',
		avatarUrl: '',
	};
	store.notify();
	wp.os.openWindow( 'desktop-mode-agent-run', { source: 'my-plugin' } );
} );
```

### Hand the agent an object

A transcript row may carry an `attachment` — the entity the message is
about. The chat renders it as a card instead of the message text, and
clicking the card opens that object's admin screen in its own window.
The drag-drop and "Send to" intakes both set it; a plugin pushing its
own row can too:

```js
store.state.transcripts[ 12 ].push( {
	role: 'user',
	// The prose is what the RUNNER reads — keep it explicit.
	text: 'Review the post "Hello world" (id 188).',
	at: Date.now(),
	// The card is what the USER sees.
	attachment: { kind: 'post', id: 188, title: 'Hello world' },
} );
store.notify();
```

`kind` is one of `post`, `page`, `media`, `user`, `comment`. The
attachment is persisted with the conversation, so a reopened
transcript still shows the card.

## Safety knobs

```php
// Tighten who may invoke agents (default: edit_posts).
add_filter( 'openstation_agents_user_can_invoke', function () {
	return current_user_can( 'manage_options' );
} );

// Platform-wide default rate limit (default: 60 runs/hour/agent).
add_filter( 'openstation_agent_default_rate_limit', fn () => 10 );

// Redact tool output before it re-enters the model context.
add_filter( 'openstation_agent_tool_result', function ( $output, $slug ) {
	if ( is_array( $output ) ) {
		unset( $output['user_email'] );
	}
	return $output;
}, 10, 2 );
```
