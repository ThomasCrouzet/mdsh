# Document and test backup fixture compatibility

Labels: `good first issue`, `testing`, `documentation`

Add small versioned fixtures for the current plaintext and encrypted backup envelopes without including personal content or live credentials.

Acceptance criteria:

- Fixtures contain synthetic records only.
- Tests validate accepted schema fields and rejected future versions.
- Documentation states that browser handles, trash, and history are excluded.
- No passphrase or secret appears in a versioned fixture.
