# Security policy

## Supported versions

| Version   | Supported                                      |
| --------- | ---------------------------------------------- |
| 1.x       | Yes                                            |
| Logto OSS | 1.46.0 (verified); other versions are untested |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting on this repository
(**Security → Advisories → Report a vulnerability**) and include:

- the connector version and the Logto version;
- a minimal reproduction (configuration shape, request/response, error code);
- the impact you expect and any suggested fix;
- whether the issue is in this connector, in Logto, or in VK OAuth 2.1 itself.

You will get an acknowledgement and a triage decision. A fix is prepared privately and released
together with an advisory once it is available. Please give reasonable time before public disclosure.

## What is in scope

- the connector source in `src/`, the build configuration and the Dockerfile in this repository;
- the connector's behaviour inside Logto (session handling, PKCE, token exchange, profile mapping,
  error payloads, log output);
- the derived image's build-time changes (the Experience `state` patch).

## Out of scope

- vulnerabilities in Logto itself, in `@logto/connector-kit` or in `zod` — report them upstream;
  inherited advisories are tracked in [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md);
- problems that require a compromised administrator account or a modified Logto database;
- VK ID service behaviour and VK account security.

## Handling secrets

Never include access tokens, refresh tokens, authorization codes, PKCE verifiers, service tokens or
real client secrets in a report, a screenshot or a log excerpt. The connector never logs them; if
you see one in a report, redact it first.
