# Security Configuration

Operational guidelines, environment knobs, and deployment hardening for self-hosted aeqi. Vulnerability disclosure lives in [`SECURITY.md`](../../SECURITY.md) at the repo root.

## Security Architecture

### Authentication & Authorization
- **JWT-based authentication** with configurable secrets
- **Multiple auth modes**: None, Secret, Accounts
- **Scope-based authorization** for agent operations
- **Proxy headers** for internal routing with token validation

### Sandboxing
- **Bubblewrap (bwrap)** for process isolation
- **Git worktrees** for file system isolation
- **Network isolation** (`--unshare-net`)
- **PID namespace isolation** (`--unshare-pid`)
- **Read-only system mounts** with controlled access

### Data Protection
- **Encrypted secret store** using ChaCha20-Poly1305
- **SQLite database** with parameterized queries
- **File system boundaries** with path traversal protection
- **Secure path resolution** with symlink protection

## Security Configuration

### Required Security Settings

#### 1. Authentication Secret
```bash
# REQUIRED: Set a strong JWT signing secret
export AEQI_AUTH_SECRET="your-strong-random-secret-here"
```

#### 2. HTTPS Configuration
```bash
# Recommended for production
export AEQI_TLS_CERT_PATH="/path/to/cert.pem"
export AEQI_TLS_KEY_PATH="/path/to/key.pem"
```

#### 3. Security Headers
Security headers are enabled by default with the following policies:
- **Content-Security-Policy**: Restricts resources to same origin
- **Strict-Transport-Security**: Enforces HTTPS
- **X-Frame-Options**: Prevents clickjacking
- **X-Content-Type-Options**: Prevents MIME sniffing
- **Referrer-Policy**: Controls referrer information
- **Permissions-Policy**: Restricts browser features

### Optional Security Enhancements

#### Rate Limiting
```bash
# Configure rate limits (requests per minute)
export AEQI_RATE_LIMIT_WINDOW=60
export AEQI_RATE_LIMIT_MAX_REQUESTS=100
```

#### Session Security
```bash
# Session timeout (seconds)
export AEQI_SESSION_TIMEOUT=3600

# Concurrent session limit
export AEQI_MAX_CONCURRENT_SESSIONS=5
```

## Security Best Practices

### 1. Deployment Security

#### Production Checklist
- [ ] Use HTTPS with valid certificates
- [ ] Set strong JWT secret (32+ random characters)
- [ ] Enable all security headers
- [ ] Configure rate limiting
- [ ] Use isolated environments (Docker, VMs)
- [ ] Regular security updates
- [ ] Monitor security logs

#### Network Security
- **Firewall rules**: Restrict access to necessary ports only
- **Reverse proxy**: Use nginx/apache as reverse proxy
- **IP whitelisting**: Restrict admin access to trusted IPs
- **VPN access**: Use VPN for internal services

### 2. Development Security

#### Code Security
- **Input validation**: Validate all user inputs
- **Output encoding**: Encode outputs for context
- **Parameterized queries**: Use SQL parameters
- **Path traversal protection**: Use secure path resolution
- **Error handling**: Don't leak internal details

#### Dependency Security
- **Regular updates**: Keep dependencies updated
- **Security scanning**: Use cargo-audit, cargo-deny
- **Minimal dependencies**: Only necessary dependencies
- **Vulnerability monitoring**: Monitor for CVEs

### 3. Operational Security

#### Monitoring & Logging
- **Security event logging**: Log auth failures, access violations
- **Audit trails**: Maintain audit logs for sensitive operations
- **Alerting**: Set up alerts for security events
- **Regular reviews**: Review security logs regularly

#### Backup & Recovery
- **Regular backups**: Backup databases and configurations
- **Encrypted backups**: Encrypt sensitive backup data
- **Disaster recovery**: Test recovery procedures
- **Incident response**: Have incident response plan

## Security Testing

### Automated Security Tests
Run the security test suite:
```bash
cargo test --test security_tests
```

### Manual Security Testing

#### 1. Authentication Testing
- Test for weak passwords
- Test for session fixation
- Test for CSRF vulnerabilities
- Test for brute force protection

#### 2. Authorization Testing
- Test privilege escalation
- Test access control bypass
- Test horizontal privilege escalation
- Test vertical privilege escalation

#### 3. Input Validation Testing
- Test SQL injection
- Test XSS vulnerabilities
- Test path traversal
- Test command injection

#### 4. Configuration Testing
- Test default credentials
- Test information leakage
- Test error handling
- Test security headers

## Incident Response

### Security Incident Procedure

#### 1. Detection
- Monitor security logs
- Watch for unusual patterns
- Respond to security alerts

#### 2. Containment
- Isolate affected systems
- Preserve evidence
- Block malicious traffic

#### 3. Eradication
- Remove malicious content
- Patch vulnerabilities
- Clean affected systems

#### 4. Recovery
- Restore from clean backups
- Verify system integrity
- Monitor for recurrence

#### 5. Post-Incident
- Document incident
- Update security measures
- Review and improve

### Reporting a Vulnerability

Do not file a public issue. Follow the disclosure process in [`SECURITY.md`](../../SECURITY.md) at the repo root.

## Compliance & Standards

### Security Standards
- **OWASP Top 10**: Protection against common web vulnerabilities
- **CIS Benchmarks**: Security configuration benchmarks
- **NIST Framework**: Risk management framework

### Data Protection
- **Encryption**: Data at rest and in transit
- **Access controls**: Principle of least privilege
- **Data minimization**: Collect only necessary data
- **Retention policies**: Define data retention periods

## Updates & Maintenance

### Security Updates
- **Regular updates**: Apply security patches promptly
- **Vulnerability scanning**: Regular vulnerability assessments
- **Penetration testing**: Regular security testing
- **Security reviews**: Regular code and configuration reviews

### Documentation Updates
- Keep this document updated
- Document security changes
- Update procedures as needed
- Review and improve regularly

## Appendix

### Security Tools
- **cargo-audit**: Rust dependency security scanner
- **cargo-deny**: Dependency license and security checker
- **OWASP ZAP**: Web application security scanner
- **Nmap**: Network security scanner

### References
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Rust Security Guidelines](https://rust-lang.github.io/rust-security-guide/)
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks/)

### Changelog
- **2024-01-15**: Initial security documentation
- **2024-01-15**: Added security headers middleware
- **2024-01-15**: Added secure path utilities
- **2024-01-15**: Fixed default JWT secret vulnerability