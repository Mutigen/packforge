# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email the maintainer or use [GitHub Security Advisories](https://github.com/mutigen/packforge/security/advisories/new).
3. Include a description, reproduction steps, and potential impact.

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Security Considerations

- packforge runs as an MCP server in a local stdio transport — it does not expose network ports by default.
- Instruction packs contain system prompts and tool permissions — always review `tools_allowed` and `tools_blocked` before activating packs in production environments.
- The context analyzer reads local file system metadata (`package.json`, file tree) but does not transmit data externally.
