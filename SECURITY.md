# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use a [**GitHub private security advisory**](https://github.com/r0073d-l053r/mesynx/security/advisories/new) — this keeps the report confidential and notifies the maintainer directly.

You should receive a response within 48 hours.

Please include the following information in your report:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

This information will help us triage your report more quickly.

## Security Best Practices

When deploying Mesynx AI:

### 1. Environment Variables
- **Never commit `.env` files** to version control
- Use strong, randomly generated values for:
  - `BETTER_AUTH_SECRET` (min 32 characters)
  - `ENCRYPTION_KEY` (exactly 64 hex characters)
- Rotate secrets regularly

### 2. Database Security
- Use strong database passwords
- Enable SSL/TLS for database connections in production
- Restrict database access to application servers only
- Regular database backups with encryption

### 3. API Keys & Tokens
- All API keys and Plaud bearer tokens are encrypted at rest using AES-256-GCM
- Never expose API keys in client-side code
- Rotate API keys periodically
- Use least-privilege access for AI API keys

### 4. Network Security
- Deploy behind HTTPS/TLS in production
- Use reverse proxy (nginx, Caddy) for SSL termination
- Enable CORS only for trusted domains
- Consider rate limiting on API endpoints

### 5. Docker Security
- Run containers as non-root user (already configured)
- Keep base images updated
- Scan images for vulnerabilities
- Use Docker secrets for sensitive data

### 6. Storage Security
- **Local Storage**: Ensure proper file permissions (600 for files, 700 for directories)
- **S3 Storage**:
  - Use IAM roles with minimal permissions
  - Enable encryption at rest
  - Enable access logging
  - Use bucket policies to restrict access

### 7. Authentication
- Enforce strong passwords
- Consider enabling 2FA (future feature)
- Session tokens are httpOnly cookies
- Sessions expire automatically

## Known Security Considerations

### 1. Plaud Bearer Token
- Bearer tokens are obtained from plaud.ai and stored encrypted
- Tokens may have long expiration times (controlled by Plaud)
- If compromised, attacker could access Plaud recordings
- **Mitigation**: Regularly rotate by reconnecting device

### 2. Client-Side Transcription
- Browser-based transcription downloads ML models (~100-200MB)
- Models are from HuggingFace CDN
- **Mitigation**: Verify model integrity, use subresource integrity when possible

### 3. File Uploads
- Recording files can be large (up to GB)
- **Mitigation**:
  - Validate file types
  - Implement file size limits
  - Path traversal protection already implemented

### 4. Server-Side Request Forgery (SSRF)
- Application fetches from Plaud API and AI providers
- **Mitigation**:
  - Validate URLs
  - Whitelist allowed domains
  - Use timeouts for external requests

## Security Updates

We will notify users of security updates through:
- GitHub Security Advisories
- Release notes
- CHANGELOG.md

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine affected versions
2. Audit code to find similar problems
3. Prepare fixes for all supported versions
4. Release new versions as soon as possible

We aim for a 90-day disclosure timeline from report to public disclosure.

## Credits

We appreciate the security research community and will acknowledge researchers who report valid security issues (with permission).

## Contact

For security concerns: [GitHub private security advisory](https://github.com/r0073d-l053r/mesynx/security/advisories/new)
For general issues: [GitHub Issues](https://github.com/r0073d-l053r/mesynx/issues)
For discussions: [GitHub Discussions](https://github.com/r0073d-l053r/mesynx/discussions) · [Discord](https://discord.gg/mgBKaEGUvc)
