# Work and ordinary chat

A conversation turn records an agent execution. Ordinary messages, replies, plans, tool use and delegation stay conversation; they do not create or promote Work. Turn history, gated tools, action receipts, input questions and saved conversation results remain available without Work.

Use create_work to propose a title, description and optional assignee from the same conversation. Creation requires explicit operation review; Full access/Never refuses that request. Accept creates one reviewed, ready-to-start item; valid edits are revalidated. Ignore, Respond, expiry and cancellation create none. Background turns without approval authority cannot create Work or open a creation approval.

In Work, the owner or a full-access device selects Start Work to begin the accepted objective. Creation does not start execution or authorize subsequent actions. Every later tool retains its own permissions. A prose claim does not create Work. Repeated delivery or resolution must not create another item or restart execution.

Delegates on assigned Work contribute to that same Work; they do not create another item. Their actions keep the same cancellation and approval scope.

Cancelling an App operation stops its daemon-owned process group and waits for child termination. Earlier effects remain; an Unknown receipt remains in history without an inspection requirement. See docs/apps.md.

The Work page uses compact summaries with the request title, next step, assigned agent, state and updated time. Open View Work for the full request, pending approvals and saved results. Execution details contains counts, the reported plan, Work ID and full timestamps; Turn history contains recorded runs. Completed Work and a reported plan remain separate from an action receipt’s execution outcome.

Work includes its originating conversation message and turn. Existing historical records are preserved and listed as actual Work, including records from the older automatic-creation behavior. No history cleanup occurs here.

An input answer continues its originating conversation or Work and supplies information only. A saved result can belong to a conversation without Work; its author, room, turn and gated tool call remain recorded. A finished turn or saved result does not prove an external action succeeded. Inspect receipts and target evidence before retrying an unknown action.

Cancelled work with a missing tool result remains interrupted in its conversation and Work history. No acknowledgement or separate Recovery queue is required. Historical outcomes do not block model changes; active execution and pending action reviews/receipts still do. A new message does not replay or confirm an old action. Questions can continue the same Work through their exact chat reply; cancellation closes its pending questions.

For behavior, migration and verification limits, see docs/notes/explicit-work.md. This handbook describes the built package; source acceptance is separate from deployment and real-model acceptance.

On a controlled daemon restart, OpenAg stops owned execution and waits for local cleanup before closing storage. Pending reviews remain pending; started actions can remain Unknown without blocking subsequent operations. An incomplete or forced stop is reported in service logs. Stopping never undoes prior effects. See [operations](../ops.md).
