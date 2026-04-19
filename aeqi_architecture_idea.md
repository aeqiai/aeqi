# Aeqi Architecture Overview

## Core Components
1. **Ideas System** - Persistent knowledge store with hybrid search (SQLite FTS5 + vector embeddings)
2. **Events System** - Reaction rules that trigger ideas when patterns fire  
3. **Agent Hierarchy** - Parent-child relationships with quest delegation
4. **Memory Consolidation** - Automatic knowledge extraction and storage

## Key Relationships
- Events reference ideas via `idea_ids` field
- Each agent owns its events (`agent_id` field)
- Ideas are stored centrally and can be referenced by multiple agents
- Lifecycle events (quest_completed, idea_received, etc.) trigger automated workflows

## Design Principles
- **Composability**: Events + Ideas = Automated workflows
- **Persistence**: Knowledge survives across sessions
- **Hierarchy**: Parent agents can delegate to children
- **Adaptability**: System learns and improves over time