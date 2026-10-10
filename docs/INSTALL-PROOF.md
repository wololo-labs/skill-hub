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

## Re-run on APM 0.33.0, 2026-10-05

The commands above were run on APM 0.29.0. Upstream is now 0.33.0, so the same
three panel commands were run again from empty directories under a throwaway
`HOME`, against a binary downloaded from the `v0.33.0` release and checked
against its published `.sha256` before it was executed.

```console
$ apm --version
Agent Package Manager (APM) CLI version 0.33.0 (18c4c43)
```

| target | exit | what was deployed |
| --- | --- | --- |
| `claude` | 0 | 4 agents to `.claude/agents/`, 3 rules to `.claude/rules/`, 4 skills to `.claude/skills/`, MCP server in `.mcp.json` |
| `copilot` | 0 | 4 agents and 3 instructions to `.github/`, 4 skills to `.agents/skills/`, MCP server in `.github/mcp.json` |
| `codex` | 0 | the MCP server in `.codex/config.toml`, and nothing else |

The pinned install line still resolves and deploys on the current release, so
the hub's command shape is unchanged by four releases of APM.

The Codex row is the finding. On 0.29.0 this was put down to Codex having no
mapping for those primitives. On 0.33.0 APM says why, and it is not that:

```console
$ apm install '.../packages/qe-agent-pack#937cc70d...' --target codex
  [!] [stevengonsalvez/ainb-toolkit/packages/qe-agent-pack] Package targets
[claude, copilot] do not overlap authorized active targets; skipping
[*] Installed 1 APM dependency and 1 MCP server in 4.4s.
```

The pack declares `targets: [copilot, claude]` in its own `apm.yml`, and APM
treats that as a restriction. Asking for `--target codex` does not override it:
the package's primitives are skipped, the install still exits 0 and still says
it installed the dependency. A user who runs the Codex line the panel offered
gets a success message and none of the pack.

The panel therefore has to offer only the targets a pack declares. That is what
the provider does from this point: a package's harnesses are its own `targets`,
and only a package that declares none falls back to the repository manifest.
