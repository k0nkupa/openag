# OpenAg

OpenAg is a personal secretary that keeps track of the owner's work, investigates agreed matters and brings back evidence and useful decisions. This language describes the product domain, including behavior still to be implemented.

## Language

**Agent**:
A persistent participant in OpenAg with its own identity, instructions, memory, skills and action permissions. A bot is the same entity; its identity is distinct from the model used for a turn.
_Avoid_: Model, provider account

**Agent handle**:
An agent's stable, unique address within an installation, used to identify it in mentions. It is distinct from the agent's display name, which may be shared by other agents.

**Avatar**:
An agent's visual representation in OpenAg. Its appearance may change or be shared by other agents without changing their identities, history, memory or action permissions.
_Avoid_: Agent identity, personality

**Avatar expression**:
Temporary visual feedback about an agent's activity, such as working, waiting for input or celebrating completion. An expression alone is not evidence that Work is complete or an external action succeeded.
_Avoid_: Mood, emotion

**Avatar library**:
The installation-wide collection of registered avatar designs available for agents to use. A generated preview enters this collection through session-authorized registration (directly under Full access, with Inbox review under Ask); adding a design does not select it for an agent.

**Default bot**:
The agent designated as the installation's fallback where a feature uses the default bot. This designation grants neither owner access nor membership in other conversations.

**Agent creation**:
The establishment of a new agent identity and its initial configuration. Creation alone grants no room membership, starts no turn and creates no Work.

**Owner**:
The person who controls OpenAg's access, standing responsibilities and action permissions. A bot acting for the owner is not itself the owner.

**Primary agent**:
The owner's main point of contact, responsible for continuity and coordination across their work.
_Avoid_: Owner bot, omniscient agent

**Specialist**:
An agent with a focused role that contributes to an investigation or Work within the authority it receives.

**Agent request**:
A bounded request addressed to an existing agent, with an identified initiator, selected context and an expected reply. It is distinct from tracked Work and grants no additional action permissions.

**Agent consultation**:
An agent request made by another agent for findings that inform the requesting agent's answer. The recipient's findings remain attributable to that recipient.
_Avoid_: Work assignment, agent creation

**Guest agent**:
An agent invited to answer a particular request in a conversation where it is not a permanent participant. That invitation does not grant access to the conversation's other history or change its membership.

**Agent mention**:
An explicit address using an agent's handle in a message. The address is distinct from the agent's display name and does not grant action permission.

**Conversation**:
An exchange among the owner and participating agents in an authorized context. Discussing a possible task is not itself a commitment to carry it out.

**Message draft**:
The user's editable message before submission to a conversation. Draft content has not yet been sent to an agent.

**Dictation**:
The user's act of speaking to produce editable message draft text. Dictating does not submit the message or start an agent turn.

**Transcription target**:
The selected service and model that convert recorded speech into text for dictation. It is independent of the agent and model that answer the eventual message.
_Avoid_: Chat model, agent voice

**Room**:
An optional, user-named conversation space with a chosen set of participating agents and a designated lead. A named room with one agent remains a room, distinct from that agent's direct chat.
_Avoid_: Group chat when excluding one-agent rooms

**Room identity**:
A room's stable, unique identity within an installation. It is distinct from its display name, which may be shared by other rooms.

**Room member**:
An agent selected to participate in a particular room. Membership in one room grants neither membership in another nor owner authority.

**Room lead**:
The designated member who answers by default when a message has no explicit agent recipient and no routing decision selects another member. Being the lead grants no additional action permissions.
_Avoid_: Room owner, default bot

**Direct chat**:
The dedicated conversation space between the owner and one permanent agent, reused when the owner returns to that agent. A guest agent can answer a particular request without becoming a permanent participant. It is distinct from a user-named room, even when that room has the same sole participant.
_Avoid_: One-agent room

**Conversation fork**:
A new named conversation that continues from an owner-selected text checkpoint. The original conversation and its action evidence remain intact.
_Avoid_: Undo, action rollback

**Room creation**:
The establishment of a new named room with its selected members and lead. An uncertain creation remains the same creation until its outcome is known; creating a room starts no agent turn or Work.

**Proactive delivery destination**:
The conversation space designated to receive proactive messages. Creating a room or choosing its lead does not itself designate that room as the destination.

**Turn**:
One agent execution in a conversation. A turn can contribute to an investigation or Work without being either of them.

**Awaiting input**:
A particular request cannot progress until its open question is answered; unrelated conversation activity can continue. The turn that asked the question may have ended normally; the request has not been cancelled.

**Cancellation**:
An explicit decision to stop the requested activity. It does not undo earlier actions or establish their outcomes.

**Conversation history**:
Past messages from an agent's authorized participation in a conversation. It is distinct from remembered facts and from the full record of tools, decisions and execution activity.
_Avoid_: Everything the agent has ever seen, memory

**Turn context**:
The authorized instructions, current request, selected conversation history and supporting data available to one agent execution. It is distinct from the owner's working context of priorities and commitments.
_Avoid_: Entire conversation, working context

**Request provenance**:
The attributable account of what OpenAg supplied for a model step, what it left out and where that account stops. It is distinct from proof that a provider received the request or an action succeeded.

**Context projection**:
The ordered selection of authorized turn context supplied for a particular model request. A later projection can differ without changing retained conversation history.
_Avoid_: Entire memory, full transcript

**Context omission**:
Authorized context that was excluded or shortened in a projection, together with the reason. An omission does not erase its source or imply that the omitted information was irrelevant.

**Request manifest**:
A bounded record of request provenance, including source references, selection limits and observed request settings. It is evidence about a request, not a replayable request or an action receipt.

**Context pressure**:
The amount of selected context relative to a stated limit and measurement basis. A text-length measure is distinct from a provider's reported token usage.

**Adapter handoff evidence**:
The observed input and configuration supplied by OpenAg to an external agent session. It does not establish the agent's internal model context or hidden provider requests.

**Operating rules**:
The owner-governed constraints on an agent's behavior within OpenAg. Quoted instructions, recalled facts and earlier agent assertions are not operating rules or action permissions.

**Context data**:
Attributable material supplied to inform an agent execution, such as remembered facts, source excerpts or a specialist's findings. Its presence does not grant authority to act or change operating rules.

**History boundary**:
A trusted limit on which past conversation messages may inform a turn. It does not erase retained records or independently change memory or action permissions.

**Work**:
An explicitly created, tracked objective with a finish line and a lifecycle. Ordinary conversation and observation do not implicitly create Work.
_Avoid_: Every reply, every activity

**Automation**:
An owner-configured instruction for an agent, activated by a schedule, an authorized event or an explicit run request. Its trigger does not create Work or grant additional action permissions.
_Avoid_: Standing responsibility, guaranteed task completion

**Scheduled occurrence**:
One due opportunity for an enabled automation under the schedule and conditions that applied at that time. Being due does not prove that execution was admitted or completed.

**Automation run**:
An admitted attempt to carry out an automation's instruction or source check. Its execution outcome is separate from whether anything was delivered to the owner.
_Avoid_: Every scheduled occurrence, every notification

**Missed occurrence**:
An expected scheduled opportunity that passed without execution, supported by the available scheduling and execution evidence. A deliberate skip or an uncertain historical gap is not automatically a missed occurrence.
_Avoid_: Quiet result, every absent run

**Automation start refusal**:
A known decision or failure that prevents an invocation from entering automation execution. Its reason distinguishes an intentional restriction from a setup or admission failure.

**Responsibility**:
An owner-approved standing agreement about what OpenAg should watch, investigate and report, including its scope and stop conditions.
_Avoid_: Unrestricted autonomy, recurring task

**Responsibility revision**:
One owner-approved version of a responsibility's trigger, permitted sources, limits and reporting rules. A later revision does not change the authority or meaning of an earlier investigation.

**Source binding**:
An approved association with a particular source, account and permitted resources. Naming a source or person does not establish that association or grant access.

**Investigation scope**:
The agreed question, sources, resources and limits that apply to one investigation. Evidence or instructions found during the investigation cannot expand that scope.

**Trigger**:
A specified condition that makes an enabled responsibility eligible to check a new development. Eligibility does not prove relevance or grant action permission.

**Source event**:
A particular message, task update or other observed development from an authorized source. Another observation of the same event is not necessarily new information.

**Issue**:
A continuing matter that may connect several source events and investigations. A shared person or topic alone does not prove that two events concern the same issue.

**Source task**:
A task or commitment recorded in a connected system, such as Asana. Discovering a source task does not create or import OpenAg Work.

**Working context**:
The current, source-backed understanding of the owner's priorities, commitments, active matters and things they are waiting for. It distinguishes explicit decisions from tentative inferences.

**Investigation**:
A bounded effort to answer a question using authorized evidence. Its result can be a finding, an unresolved question or an explicit statement that the available evidence is insufficient.
_Avoid_: Automatic action, settlement

**Evidence**:
An attributable observation used to support a finding, with enough source and time context to judge its applicability. An agent's assertion alone is not evidence that an external action succeeded.

**Evidence reference**:
An identifier for a retained observation with its source, scope and observation time. A reference supplied in a message is not evidence until an authorized read establishes what it refers to.

**Finding**:
A conclusion supported by identified evidence, with uncertainty and conflicting information retained.

**Result**:
The usable output of an investigation or Work, including findings, artifacts, unresolved matters and suggested next steps where appropriate.
_Avoid_: Successful turn, activity log

**Turn outcome**:
The recorded account of how one agent execution ended. Completion of a turn does not by itself establish that Work is complete or that an external action succeeded.

**Incomplete turn**:
An execution that stopped with part of its answer or required processing unresolved. Its partial findings remain usable, but they are not a claim that the requested investigation finished.
_Avoid_: Successful partial completion, unknown action outcome

**Execution allowance**:
The owner-governed limit on how much processing an agent execution may perform. Reaching an allowance does not grant permission to repeat actions or conceal remaining work.

**Model step**:
One opportunity for an agent to obtain the next model response from its current authorized context. Additional attempts to obtain that response are not additional decisions or permission to repeat tools.

**Model-request attempt**:
One submission for the response needed by a particular model step. An attempt can end without a usable response even if the provider processed it.
_Avoid_: Retrying the task, replaying the turn

**Turn continuation**:
A further bounded execution that carries forward retained findings and unresolved matters. It preserves applicable action permissions, execution limits and uncertainty rather than treating earlier actions as unperformed.
_Avoid_: Start over, automatic replay

**Coverage gap**:
A period, source or portion of a question that OpenAg could not check. A coverage gap is different from evidence that nothing changed.

**Suggested reply**:
Unsent text prepared for the owner to review and use. Preparing this text does not authorize sending it or creating a draft in an external account.

**Recommendation**:
A proposed next action with reasons tied to the owner's priorities and current evidence. A recommendation is not an action permission.

**Attention item**:
A finding, blocker or decision considered for delivery to the owner. Its delivery can be immediate, deferred to a brief or suppressed under the owner's attention preferences.

**Brief**:
A scheduled, concise account of material developments, unresolved matters and decisions relevant to the owner.

**Memory**:
Retained facts, preferences and decisions used to maintain continuity. Remembered information can be outdated and must not replace current evidence or grant permission.

**Skill**:
A reviewed, reusable method for carrying out a class of work. A skill describes how to work; a responsibility defines what to keep watching and when to act within an agreed scope.

**Skill package**:
The instructions and supporting resources that describe a reusable method. Finding a package does not establish that it has been reviewed, assigned or is ready to use.
_Avoid_: Approved skill when referring to a discovered package

**Skill source**:
An identifiable origin from which OpenAg discovers skill packages. Enabling a source permits discovery, not automatic assignment or action permission.

**Shared skill library**:
A skill source whose packages can be selected for more than one agent. Sharing a library does not give every agent access to every package.
_Avoid_: Global skills when implying all agents receive them

**Agent-owned skill**:
A skill maintained for one agent through OpenAg's approved authoring process. It is distinct from a shared package assigned to that agent.

**Skill catalogue**:
An inventory of discovered skill packages with their identities, origins and known availability. A catalogue entry does not establish readiness or assignment.
_Avoid_: Agent's skills when referring to the entire inventory

**Skill assignment**:
The owner's selection of a particular shared skill package for an agent. It selects the package rather than freezing its contents, and grants no permission for the actions it describes.
_Avoid_: Tool approval, package installation

**Skill readiness**:
The known ability to load a package and satisfy its requirements in an agent's current environment. Readiness does not establish assignment, action permission or successful execution.

**Question**:
An agent's request for information needed to continue a specific matter in a conversation.

**Answer**:
Information supplied in response to a particular question. An answer does not grant action permission.

**Approval request**:
A specific proposed action presented for an explicit decision about its scope.

**Provider input**:
Information or consent requested by a connected service during an operation. It is distinct from OpenAg action approval.

**Approval**:
A decision authorizing a specific reviewed operation within its stated scope. Approval of one operation does not authorize its later effects or unrelated operations.

**Permission mode**:
The owner's chosen combination of a filesystem boundary and an approval policy for an agent's conversation. A mode does not establish ownership, connect a provider account or confirm an action's result.
_Avoid_: Device access, provider consent, tool category

**Permission session**:
The continuing permission context of one agent in one conversation. It can span several turns and is distinct from an individual action approval.

**Effective permissions**:
The permissions that apply to an agent's requested operation after its conversation mode and any independent restrictions are combined. A description of these permissions informs the agent; it does not itself authorize execution.
_Avoid_: Model-granted permissions, adapter mode

**Native execution**:
Operations performed directly by an agent runtime rather than through OpenAg's offered tools. Full access does not enable native execution; its restrictions are separate from the conversation's permission mode.
_Avoid_: OpenAg tool execution

**Filesystem boundary**:
The enforced limit on where an agent's operations may write files in their execution environment. It does not by itself restrict network access or remote service effects.

**Workspace**:
The owner-selected file area in an execution environment within which Workspace Write permits changes. It is distinct from a conversation and from an integration's remote resources.

**Approval policy**:
The owner's choice of whether an operation that requires review may ask for approval. Never asking refuses such a request rather than granting it automatically.

**Escalation**:
A request to perform one operation beyond its current filesystem boundary. An accepted escalation authorizes that operation's stated scope without changing the conversation's permission mode.

**Full access**:
A permission mode that removes filesystem confinement and does not prompt for action approvals. It leaves independent access controls and explicit refusals in effect.
_Avoid_: Owner access, approval of every request

**Offered tool**:
A capability made available to a particular agent in its current context, whether supplied by OpenAg, an installed App or an integration. Availability does not establish permission to use it.
_Avoid_: Approved tool, connected account

**Tool action**:
One requested use of an offered tool with particular inputs and scope. Its approval and execution outcome belong to that operation, even when several components carry the request.
_Avoid_: Integration connection, every internal handoff as a separate action

**Daemon-owned execution**:
An execution for which OpenAg owns authorization, stopping local activity and retaining outcome evidence. It does not imply control over effects already accepted by an external service.

**Execution stop**:
The confirmed end of daemon-controlled activity for a turn or tool action. It does not undo earlier effects or resolve an Unknown action outcome.
_Avoid_: Cancellation request, confirmed failure

**Tool classification**:
A trusted assessment of the effects a tool action can have. Classification is distinct from the permission mode and an action approval; availability and provider consent do not establish its classification.

**Invocation completion**:
The observed completion of a requested tool operation. A returned query can establish discovery or read results without establishing access to other operations.

**Effect confirmation**:
Evidence that an intended change happened at its target. A returned tool response alone does not establish an external effect.

**Action receipt**:
A retained account of an action's reviewed proposal, authorization and observed execution outcome. An unknown outcome remains uncertain until appropriate evidence establishes what can happen next.

**Effect scope**:
The resources an action can change, as established by its trusted execution contract. An opaque effect scope cannot establish independence from another write.

**Receipt inspection**:
A recorded assessment of retained evidence about a particular action and its target. It preserves the historical outcome and does not repeat the action or authorize another attempt.

## Access and integrations

**Installation**:
One OpenAg daemon and the state it owns, shared by its desk clients and bots.
_Avoid_: Account when referring to an OpenAg installation

**Owner access**:
Authority to administer an installation, held through its owner credential or a device granted Full access. It does not grant access to an external provider account or approve an external tool action.
_Avoid_: Provider login, Composio ownership

**Device access**:
The Limited or Full authority granted to a paired desk client. Full access permits owner actions within the client's supported connection; transport-specific restrictions still apply.
_Avoid_: User role, provider permission

**Paired device**:
A desk client granted revocable access to an installation. One physical phone or computer may contain several separately paired clients.
_Avoid_: Physical device when referring to an OpenAg access identity

**Integration**:
A capability that lets OpenAg work with an external provider or service. An integration may require an account connection or installation-level prerequisites before it is usable.
_Avoid_: Account, connection when referring to the capability itself

**Integration connection**:
An installation's authorized relationship with an integration provider, such as Composio or Google. One Composio connection can make multiple service accounts available; each remains subject to its own consent and OpenAg's tool policy.
_Avoid_: Owner login, service account when referring to the Composio connection

**Connector package**:
A bundled connector's reviewed code, identified by its content digest. Installing one places that code on the daemon host; it does not enable access or approve tools.
_Avoid_: Setup package, recipe, reviewed recipe

**Package pin**:
The administrator-managed record binding a configured connector to one connector package digest. It identifies which code is trusted, not which program or release starts it.
_Avoid_: Reviewed recipe, command pin

**Launch command**:
The program and arguments the daemon uses to start a connector package. The daemon chooses it; configuration does not.
_Avoid_: Stored command

**Provider account**:
An identity at an external provider used when authorizing an integration connection. For Composio, this is the Composio account, distinct from a Gmail or Slack account connected through it.
_Avoid_: OpenAg account, owner

**Connected service account**:
An external service identity, such as a Gmail or Slack account, authorized for use through an integration. Connecting it grants the provider relationship needed for access, not automatic approval of OpenAg tool actions.
_Avoid_: Service account when it could mean a machine identity, Composio account

**Desk address**:
A browser address through which a person uses an installation's desk. Several desk addresses can lead to the same installation.
_Avoid_: Provider callback, installation identity

**Trusted desk address**:
A desk address the installation approves for use as a sign-in return destination. Approval of an address does not grant device access to someone visiting it.
_Avoid_: Trusted app address, any reachable address

**Provider callback address**:
The address at which OpenAg receives an integration provider's sign-in response. It is distinct from the desk address and must be accepted by the provider and reachable by the browser completing sign-in.
_Avoid_: Desk address, sign-in return destination, callback when its recipient is unclear

**Hosted callback relay**:
An OpenAg-operated service that receives a temporary provider sign-in response and makes it available only to the installation that started that attempt. It does not establish owner access or approve tool actions.
_Avoid_: Provider account store, public access to the installation

**Private callback route**:
A provider callback address available through the installation's private network. Its availability does not grant device or integration access.
_Avoid_: Public relay, desk login

**Sign-in return destination**:
The trusted desk address and screen to which the person returns after a sign-in attempt. Returning there does not by itself establish an integration connection or grant device access.
_Avoid_: Provider callback address, arbitrary return URL

**Initiating device**:
The paired device whose authority started a particular sign-in attempt. Another browser receiving the provider response does not become that initiating device.
_Avoid_: Callback browser, current browser when identifying the authorizing device

**Sign-in attempt**:
A temporary authorization process started by an initiating device to establish or renew an integration connection. It may complete, expire, be cancelled or be denied without changing that connection.
_Avoid_: Connection when sign-in has not completed

**Sign-in completion**:
Acceptance of the provider's response for a particular sign-in attempt and establishment or renewal of its integration connection. A browser redirect alone is not completion.
_Avoid_: Browser return, owner sign-in

## MCP servers

**MCP server**:
A tool provider that an installation links to over the Model Context Protocol. It may deliver an integration but is not itself an integration connection or a provider account.
_Avoid_: Connector when referring to the provider itself, integration

**Needs sign-in**:
The state of a custom MCP server that signs in with OAuth and has no valid grant (never signed in, signed out, or the provider rejected the refresh). Its tools are not offered until the owner signs in again.
_Avoid_: Disconnected, expired

**Command review**:
The owner's approval of the exact local command a custom MCP server will run on the OpenAg computer. It binds to what was shown, so any change to the program, arguments, environment names or reviewed script files needs a new review.
_Avoid_: Command approval, install

**MCP secret**:
A credential the owner types into the desk for one custom MCP server. It is stored encrypted on the OpenAg machine, never shown again, usable only for that server's address, and deleted when that address changes or the server is removed.
_Avoid_: Token field, API key

**Custom MCP server**:
An MCP server added by the owner, as opposed to one built into OpenAg or reached through an integration connection. The owner may edit or remove it.
_Avoid_: Connector, third-party connection

**Server status**:
Whether an installation can currently use an MCP server's tools: disabled, starting, ready, needs sign-in or failed. It says nothing about approval of any tool action.
_Avoid_: Connection, integration connection

**Server check**:
An approved attempt to reach an MCP server and list its tools without making them available. Approving a check does not approve any tool action the server offers.
_Avoid_: Test connection, connecting

**MCP connection session**:
The integration exchange context in which OpenAg and a remote server agree on their supported capabilities. It does not grant permission to execute tools.

**Provider workflow**:
An integration provider's context carried between related tool requests. Reusing it does not reuse an action approval or an interaction response.
_Avoid_: MCP connection session, bot conversation

**Remote invocation**:
One request to an integration tool and its reply or transport outcome. A returned reply does not by itself prove an external action's effect.

**Server interaction**:
A request from an integration for the owner's information or explicit participation during a remote invocation. Answering it is separate from approving the tool action or changing tool permissions.
_Avoid_: Work question, tool approval

**Interaction response**:
The owner's explicit answer, decline or cancellation of a server interaction. It belongs only to the invocation that requested it.

**Tool contract**:
The offered identity and input requirements of an integration tool at a particular point in time. A changed contract requires a fresh proposal before execution.

**Task-only tool**:
An integration tool that requires a separate asynchronous task lifecycle rather than an immediate invocation reply.
