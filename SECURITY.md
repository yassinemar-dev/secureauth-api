# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.0.x (current) | Yes |
| Earlier versions | No |

This is an early-stage boilerplate. Fixes are applied to the current main branch.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security problem.

Use GitHub's private vulnerability reporting for this repository: open the **Security** tab, choose **Report a vulnerability**, and fill in the advisory form. Include the affected version/commit, reproduction steps, impact and any suggested fix. If private reporting is unavailable, contact the maintainer privately through GitHub before disclosing details publicly.

We aim to acknowledge reports within a few days, but this is not a binding SLA. Please give reasonable time for a fix or coordinated disclosure before publishing details.

## Scope notes

The API is a boilerplate, not a hosted service. Reports about missing MFA, email verification, password reset, audit logging, TLS termination or shared rate-limit storage are documented trade-offs rather than vulnerabilities in the current scope; see the "Threat model" section of `README.md`.
