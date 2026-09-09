# Install proof

## The gesture, driven in a real browser

Before the commands below, the panel itself. Chromium against the running hub,
clipboard read back rather than assumed:

```
harness picked      Codex
clipboard contains  apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack
                    #937cc70d4a371e4189e891a113fe5374eaefaaa9' --target codex
button reports      Copied
receipt delivered   {"actor":"user:development/guest",
                     "ref":"api:stevengonsalvez-ainb-toolkit/playwright-test",
                     "harness":"codex","verdict":"PASS"}
```

On an unscored asset the same page has zero copy buttons and says
`Install is blocked until this asset has a score`. The gate is the absence of a
control, not a control that fails when pressed.

The install panel hands over one command per harness. These are those exact
commands, run for real against APM CLI 0.29.0 from empty directories under a
throwaway `HOME`, on 2026-09-06. Nothing here is reconstructed: every command
was copied from the panel and pasted into a shell.

The pack is pinned to the commit the hub read it at, so these keep working
regardless of what lands on the branch afterwards.

## Claude Code

```console
$ apm --version
Agent Package Manager (APM) CLI version 0.29.0

$ pwd
<tmp>/install-proof/work

$ ls -A

$ apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target claude
[*] Created apm.yml
[i] Targets set: claude (persisted to apm.yml)
[*] Validating 1 package...
[+]
stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe
5374eaefaaa9
[*] Updated apm.yml with 1 new package(s)
[>] Installing 1 new package...
[>] Resolving ainb-toolkit-qe-agent-pack...
[i] Targets: claude  (source: --target flag)
  [+]
github.com/stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e418
9e891a113fe5374eaefaaa9 #937cc70d4a371e4189e891a113fe5374eaefaaa9 @937cc70d
  |-- 4 agents integrated -> .claude/agents/
  |-- 3 rule(s) integrated -> .claude/rules/
  |-- 4 skill(s) integrated -> .claude/skills/
[i] Added apm_modules/ to .gitignore
[i] Trusting direct dependency MCP 'playwright-test' from 'qe-agent-pack'
+- MCP Servers (1)
[i] Targeting specific runtime: claude
|  [>]  playwright-test (self-defined, stdio)
|     +- Configuring for Claude...
Successfully configured MCP server 'playwright-test' for Claude Code
  + playwright-test
|  [+]  playwright-test -> Claude (configured)
[*] Configured 1 server

[*] Installed 1 APM dependency and 1 MCP server in 2.2s.

$ ls .claude/skills/
expect-test
find-missing-tests
test-driven-development
webapp-testing

$ ls .claude/agents/
playwright-test-generator.md
playwright-test-healer.md
playwright-test-planner.md
test-engineer.md

$ ls .claude/rules/
ci-wait-discipline.md
playwright-reports.md
test-strategy.md

$ cat .mcp.json
{
  "mcpServers": {
    "playwright-test": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "playwright",
        "run-test-mcp-server"
      ]
    }
  }
}

$ grep resolved_commit apm.lock.yaml
  resolved_commit: 937cc70d4a371e4189e891a113fe5374eaefaaa9

$ grep -c sha256 apm.lock.yaml
47
```

## GitHub Copilot

```console
$ apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target copilot
  |-- 4 agents integrated -> .github/agents/
  |-- 3 instruction(s) integrated -> .github/instructions/
  |-- 4 skill(s) integrated -> .agents/skills/
|  [+]  playwright-test -> Copilot (configured)
[*] Installed 1 APM dependency and 1 MCP server in 0.6s.

$ find . -maxdepth 3 -type d -not -path '*/apm_modules*' | sort
.
./.agents
./.agents/skills
./.agents/skills/expect-test
./.agents/skills/find-missing-tests
./.agents/skills/test-driven-development
./.agents/skills/webapp-testing
./.github
./.github/agents
./.github/instructions
```

## Codex

```console
$ apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target codex
|  [+]  playwright-test -> Codex (configured)
[*] Installed 1 APM dependency and 1 MCP server in 0.4s.

$ find . -maxdepth 3 -not -path '*/apm_modules*' | sort
.
./.codex
./.codex/config.toml
./.gitignore
./apm.lock.yaml
./apm.yml
```

The Codex target is honest about what it does and does not do: at APM 0.29.0 it
wires the MCP server into `.codex/config.toml` and deploys no skills, agents or
instructions, because those primitives have no Codex mapping yet. The command
the panel offers is the right command and it succeeds; it simply delivers less
than the other two targets do. Nothing in the hub asserts otherwise.

## Re-run on 2026-09-08

The same command, into a clean `HOME` with no prior agent configuration:

```console
$ apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target claude
  |-- 4 agents integrated -> .claude/agents/
  |-- 3 rule(s) integrated -> .claude/rules/
  |-- 4 skill(s) integrated -> .claude/skills/
[*] Installed 1 APM dependency and 1 MCP server in 2.7s.
```

The browser side, driven end to end against the container on 7007: search for
the asset, open it, pick a harness, copy, then read the clipboard back.

```
gate before:   BLOCKED
copy button before acknowledging: 0
COMMAND SHOWN: apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target codex
CLIPBOARD    : apm install 'stevengonsalvez/ainb-toolkit/packages/qe-agent-pack#937cc70d4a371e4189e891a113fe5374eaefaaa9' --target codex
match: true
receipt: Copy recorded: qe-agent-pack for Codex.
```

The gate in front of the copy button is not the unscored one. This asset is
scored, and its score was measured at `422e8f6d`, which is not the commit the
manifest pins. The panel refuses the command until that mismatch is
acknowledged, which is the state the asset is genuinely in today.

The unscored case, on the same run:

```
copy buttons: 0
reason:      Install is blocked until this asset has a score
explanation: Nobody has run an eval gate against this asset, so there is
             nothing to say whether it works.
```
