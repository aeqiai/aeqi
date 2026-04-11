# UI Design

This document defines the target shape of the AEQI UI as an operator product.

It is grounded in the current frontend under `apps/ui`, which exposes sessions, dashboard, agents, quests, events, ideas, and settings.

## Product Goal

The AEQI UI should become the most usable surface for operating AI-mediated work.

It should not feel like:

- a pile of admin dashboards
- a generic chat app
- a legacy quest manager with AI widgets

It should feel like a control plane where a human can move fluidly between thought, structure, execution, and oversight.

## Current State

The current UI has meaningful coverage:

- sessions are the core interaction surface with persistent agent conversations
- there are pages for sessions, agents, quests, events, ideas, and settings
- the dashboard surfaces stats, activity feed, budget, and agent overview
- layout: agent nav --> floating nav bar --> content

The main gaps are coherence and operator flow:

- too much page sprawl
- chat, quest state, and operational context still feel separate
- vendor residue still shows through in places like dashboard rate-limit language
- the UI is more "many views" than "one operational cockpit"

## Design Principles

### 1. Chat-first, not chat-only

Chat should be the fastest entry point, but it must live inside a richer operational shell.

The operator should be able to:

- start from a prompt
- see what work was created
- inspect execution state
- intervene
- view context and memory
- approve or redirect

without losing the thread.

### 2. Timeline over tabs

Users should understand work through a single connected timeline:

- messages
- quest creation
- scheduling
- worker progress
- approvals
- verification
- outcomes

Important state should not be hidden behind disconnected pages if it belongs to the same piece of work.

### 3. Context always visible

The operator should never have to guess:

- what agent/scope this belongs to
- who is working on it
- what the quest state is
- what constraints apply
- what evidence exists

The UI should keep live context visible while the operator is reading or typing.

### 4. Notes and work must connect directly

Ideas should serve as durable directives. The UI must reflect that.

The flow should be:

- capture an idea
- turn it into intent
- attach it to goals, missions, or quests
- keep the idea visible as an ongoing driver of decisions

### 5. Metrics over vanity

The UI should optimize for operational truth, not decorative activity.

Important signals:

- blocked work
- approval queues
- budget pressure
- execution health
- readiness
- mission outcomes
- domain metrics

Less important:

- raw message counts
- animation for its own sake
- dashboard ornamentation without actionability

## Target Information Architecture

The UI should converge on five primary surfaces.

### 1. Inbox

The default landing surface.

It should combine:

- active conversations
- pending approvals
- blocked work
- critical alerts
- mission changes

This is the operator's "what matters now" surface.

### 2. Thread

The main work surface.

A thread should unify:

- conversation
- quest timeline
- runtime events
- artifacts
- approvals
- outcomes

The current chat page is the right foundation for this.

### 3. Workspace

A mission workspace should show:

- goals
- quests
- active workers
- ideas and knowledge
- metrics
- recent decisions

### 4. Org

This should make humans and agents legible:

- roles
- mandates
- ownership
- reporting lines
- ideas (injection-mode as expertise)
- active workload

### 5. Command Surface

The UI should let advanced users act quickly through:

- command palette
- keyboard-first navigation
- inline approvals
- quick creation of quests, ideas, missions, and interventions

## Short-Term UI Priorities

These should come before broad visual redesign work.

### 1. Make chat the real execution cockpit

Improve the thread model so the operator can see:

- quest state
- worker progress
- verification evidence
- blocked questions
- approvals

in one continuous view.

### 2. Unify duplicated pages

Several current areas should become tighter or merge:

- chat + operations timeline
- ideas navigation
- dashboard + inbox prioritization

### 3. Remove vendor residue

The product should speak in AEQI terms.

Examples:

- no `Claude Code` special language in generic control surfaces
- no runtime-specific assumptions in primary UI concepts

### 4. Make ideas a first-class surface

Ideas should be browsable and editable as a top-level operator object.

### 5. Add org and mission clarity

AEQI's differentiator is not a prettier quest list. It is organization-aware execution. The UI must show that.

## Runtime-Aware UI

The UI should be designed with the native runtime in mind.

That means it should eventually display:

- runtime session state
- phase transitions
- tool-call summaries
- artifacts produced
- verification evidence
- cost and budget pressure
- handoff or resume state

The operator should be able to answer "what is AEQI doing right now?" without reading logs.

## Visual Direction

The interface should feel precise, calm, and authoritative.

It should avoid:

- empty enterprise chrome
- dashboard noise
- novelty visual effects that reduce scanability

It should favor:

- sharp hierarchy
- dense but legible panels
- clear status color semantics
- keyboard-first interaction
- obvious intervention points

## Decision Rule

Prefer UI work that improves:

- operator comprehension
- intervention speed
- trust
- context visibility
- work-to-outcome flow

Do not prioritize visual work that makes the interface prettier but less operationally useful.
