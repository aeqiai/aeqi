# AEQI Supercharge Implementation Plan

## Current State Analysis

### Existing Components:
1. **SecretStore** - Basic encrypted storage with ChaCha20-Poly1305
2. **MCP Authentication** - sk_/ak_ key validation for platform mode
3. **Agent Tree** - Parent-child hierarchy with inheritance
4. **CLI Commands** - Basic secret management commands

### Gaps to Address:
1. **Agent-scoped secrets** - Secrets need hierarchical scoping (company/agent/session)
2. **CLI Auth Routing** - CLI commands should work with auth keys
3. **Agent-scoped MCP Keys** - Keys should bind to specific agents
4. **Enhanced Secret Storage** - Audit logging, rotation, injection

## Phase 1: Enhanced Secret Storage (Week 1-2)

### 1.1. Hierarchical Secret Scoping
- Extend `SecretStore` to support scopes: `company/{company_id}`, `agent/{agent_id}`, `session/{session_id}`
- Add scope validation and inheritance
- Implement scope-based secret lookup

### 1.2. Audit Logging
- Log all secret accesses (read/write/delete)
- Include timestamp, agent ID, scope, and purpose
- Store logs in encrypted audit trail

### 1.3. Secret Rotation
- Automatic rotation based on age
- Versioning support for secrets
- Graceful transition between versions

### 1.4. Injection Mechanism
- Inject secrets into agent sessions via environment variables
- Secure channel for sensitive secrets
- Scope-aware injection (only inject secrets the agent has access to)

## Phase 2: CLI Auth Routing (Week 3-4)

### 2.1. Key-based CLI Authentication
- Add `--hosted` flag to CLI commands
- Implement `ak_`/`sk_` authentication for CLI
- Route commands to hosted runtime via HTTP

### 2.2. Local Fallback System
- Fall back to local daemon when no network/auth
- Graceful degradation with user warnings
- Configurable timeout and retry logic

### 2.3. Session Token Management
- Short-lived JWT tokens after auth
- Automatic token refresh
- Token revocation support

### 2.4. Command Routing Infrastructure
- Unified command router for local/hosted execution
- Telemetry and usage statistics
- Error handling and recovery

## Phase 3: Agent-Scoped MCP Keys (Week 5-6)

### 3.1. Key Binding to Agents
- Extend key creation to accept optional `agent_id` parameter
- Store key-agent binding in secure storage
- Validate key-agent relationships on API calls

### 3.2. Tree-based Permission Validation
- Implement agent tree traversal for permission checks
- Validate key has access to target agent and children
- Root key support (no agent binding = full access)

### 3.3. Budget and Permission Inheritance
- Agent-scoped budget enforcement
- Permission inheritance down the tree
- Audit logging for key usage

### 3.4. API Endpoint Updates
- Update MCP validation endpoint to check agent scope
- Add agent-scoped key management endpoints
- Backward compatibility for existing keys

## Phase 4: Integration & Testing (Week 7-8)

### 4.1. End-to-End Workflow
- Complete integration of all components
- Test workflows with real scenarios
- Performance benchmarking

### 4.2. Security Audit
- Penetration testing
- Cryptographic review
- Access control validation

### 4.3. Documentation
- API reference updates
- CLI usage examples
- Migration guide for existing users

## Phase 5: Deployment & Monitoring (Week 9-10)

### 5.1. Staged Rollout
- Internal testing with development team
- Beta release to early adopters
- Gradual rollout to all users

### 5.2. Monitoring & Alerting
- Key usage metrics
- Performance monitoring
- Security event monitoring

### 5.3. Rollback Plan
- Feature flags for easy disablement
- Database migration rollback scripts
- Client version compatibility matrix

## Implementation Priority Order

1. **Enhanced Secret Storage** (Foundation for everything else)
2. **CLI Auth Routing** (Immediate user value)
3. **Agent-Scoped MCP Keys** (Advanced feature)
4. **Integration & Polish** (Final touches)

## Success Metrics

1. **Security**: No secret leaks, proper access controls
2. **Performance**: <100ms overhead for secret operations
3. **Usability**: Intuitive CLI and API interfaces
4. **Reliability**: 99.9% uptime for hosted services
5. **Adoption**: Smooth migration for existing users