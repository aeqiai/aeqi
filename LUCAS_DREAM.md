# Luca's Dream — Overnight Guidance (2026-04-22)

> Verbatim from Luca, handed off at sleep. Treat as the north star for the
> overnight run. Don't take too literally — leverage taste and judgment.

## Raw message

im slepeign now youc an do eeryhtign yorueslf you got 7 hours make a heartbeat
of 8min to improve the systme maek it clean improve teh code make it perfect i
want you to literalyl use maybe for the work a cheaper mdoel sicne i am low on
usage now. but you can ltieraly usae asyn csubagetns and the hedartbeat and
keeo working on it until 7am! tehn you wrap it up comit merge push finaliez
etc.. remvoe teh odl worktree and be doen with it.. i want to prioritize UI UX
simpplcitiy and it acutalyl workign .. adn you want to imrpvoe the event quest
idea pages.. and the agetns page 4 canoncail apges right ... maek it perfect
make it coutn espeicalyl for teh origanal suecase of saiyn ghey can you create
an agent and confgiure its identiy . which woudl be creatign an event which
thsi agent uses as sessionstartevent inejcting na diea which woudl eb the
idendity?! do you ifnaly dunerstandhwo we got here odign this.!? and if you
manage tehn ehre teh last ultiamte task: i want you to in teh chat itself if
we edit an idea or create an dea make any inchat refernces to dieas/events/
quests soemthgin cexcitign black a preview able to click into it. saem as the
inejctions or evetns firign. they shoudl eb soemthign black preview style slim
esayto digetst nto itnrusvie etc right. jsut wehn we creat or edit a new event
quets agetn ro osemthgin ro dmfiy them ti can be mroe vsiibel previwe style
teh eevne tiidea iencjtion is the msto minimal case. but all thsoe 4 primties
will be if they ever are tocuehd used in teh caht hsitroy in the tool hstiroy
or below we maek teh m pop or maybe below a n asnewr  tehr a way an agetn ecan
refefcne an dusmarize teh idea they created at thee nd and it woudl render
speicifcly if teh y psto spa specifi cjson in its repsone referncign an id or
nto fo rexmapel we coudl avhe our inline mrenering o fan uuid which then
resovles into agent revent quest or idea. foe exmapel oyu feel me?! same on
the idea page rendering we ocudl refernce thsoe inlien arleady right?! same
for a repseone fo metext of an agetn. or even as a suer for the inptu i want
to refercne those erasiyl or osemthgin idk. thsi is alot save my message as
your guidance in a file . lucas dream. and then youc an work on ti thank you.
dotn take me too  ltieral. my main obejctive is to elverave that you are
ltieralyl smart have taste and know awht to do if i give oyu soem guidance
which i did now

## Interpreted North Star

**Headline outcome:** a user can say "create an agent and configure its
identity" and end up with (a) an agent, (b) a session:start event on that
agent, (c) an idea that holds the identity text — all cleanly linked,
visible in the right places, and working. This is the acceptance test.

**Pillars (in priority order):**

1. **It actually works.** The scope model on ideas/events/quests (self /
   siblings / children / branch / global + agent_id anchor) lands end-to-end.
   Backend, tools, UI. No half-done migration, no dead columns.
2. **UI/UX simplicity.** The four canonical pages — agents, events, quests,
   ideas — feel calm, consistent, and don't force Luca to think about
   schema. Scope chips, clean filters, the creation flow should not require
   reading docs.
3. **Inline primitive previews.** Anywhere a primitive is referenced in
   chat (tool history, assistant text, user input), it resolves to a slim,
   click-through preview card — black/minimal, not intrusive. Event-fire
   injection chips are the north-star visual. Extend that pattern:
     - agent ref → name + avatar + subtree badge
     - event ref → pattern + idea chip row
     - idea ref → name + tag chips + preview
     - quest ref → subject + status
   Resolution mechanism: inline `[[aeqi:<uuid>]]` or similar markdown
   token → RichMarkdown extension already exists for ideas; extend it.
4. **Canonical identity-setup flow.** One button or one command: "configure
   identity for this agent" → scaffolds the idea + the session:start event
   wiring automatically. This is the demo-able headline.

**Deferrables / don't fight scope here:**
- Don't rewrite the streaming reducer.
- Don't touch the quest dependency inference.
- Don't refactor `spawn_session`.
- No new providers, no new transport.

**Guardrails:**
- Pre-commit hook: cargo fmt + clippy -D warnings + cargo test + tsc + prettier
  must all pass before each commit.
- No backwards-compat aliases / no "// removed" comments / no `#[allow(dead_code)]`.
- Use `spawn_blocking` for SQLite in async.
- Don't say "prompt" in user-facing copy — four primitives only.
- lowercase "aeqi" in prose/UI, not "AEQI".
- Design system v4 (graphite + ink). Jade reserved for success.

**Wrap-up at ~6:30 AM:**
- Rebase onto latest main if moved.
- Final build + lint + test.
- Squash-commit or clean commits, push.
- Either open a PR or merge to main based on state.
- Remove the `nightshift/scope-model` worktree when merged.
