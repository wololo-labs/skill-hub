# skill-hub

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

skill-hub is a Backstage application for discovering agent assets such as
skills, prompts, hooks, evaluation suites, and MCP servers. Repositories opt in
with an asset manifest. The hub renders provenance and recorded evaluation
metadata, then offers supported install commands.

## Status

This project is alpha software. It is suitable for local development and
evaluation. Deployment hardening, authentication policy, and repository access
rules are the responsibility of each operator.

## Requirements

- Node.js 22 or 24
- Corepack
- Docker, optional, for the Compose stack
- A GitHub token only when scanning repositories that require authentication

## Local development

```console
corepack enable
yarn install --immutable
yarn start
```

The frontend listens on port 3000 and the backend listens on port 7007 by
default. Local development uses guest identity and an in-memory database.

## Compose

```console
cp .env.example .env
docker compose up
```

Review `.env.example` before starting Compose. Do not commit populated
environment files.

## Verification

```console
yarn tsc
yarn lint:all
yarn test
```

## Security

Use GitHub's private vulnerability reporting for security reports. Do not open
a public issue containing credentials, private URLs, or customer data.

## Contributing

Focused pull requests are welcome. Run the relevant verification commands,
describe behavior changes, and keep sensitive information out of commits.

## License

Copyright 2026 Steven Gonsalvez. Licensed under the
[Apache License, Version 2.0](LICENSE).
