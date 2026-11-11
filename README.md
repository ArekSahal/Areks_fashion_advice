# Cloey

An app to document your wardrobe, log daily outfits, get matching suggestions, buy and sell
clothes, analyse your style, and recreate outfits from inspiration photos.

**Test it on your phone:** https://areksahal.github.io/Areks_fashion_advice/
(`/build.txt` shows which branch is live right now).

## Owner guide

AI agents build this app. You steer them from GitHub.

### Where to look
| I want to know... | Look here |
|---|---|
| What needs me right now | Top of the pinned **[📡 Heartbeat](https://github.com/ArekSahal/Areks_fashion_advice/issues/1)** issue ("Waiting on owners") |
| What happened since last time | Latest comment in the Heartbeat issue |
| What we're building | [`docs/PRODUCT.md`](docs/PRODUCT.md) |
| What's planned, in which order | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| What we've decided and why | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Ideas we've parked | [`docs/IDEAS.md`](docs/IDEAS.md) |
| How the agents work (their rules) | [`AGENTS.md`](AGENTS.md) |

### Talking to the agents
Comment in the Heartbeat issue (or any issue). The agents pick it up on their next run (weekday mornings).

| Command | Example | What happens |
|---|---|---|
| `/direct` | `/direct do the wardrobe grid before AI tagging` | Changes priorities or direction |
| `/idea` | `/idea let friends vote on outfits` | Added to IDEAS.md with a short evaluation |
| `/discuss` | `/discuss separate dev database?` | Agent lists options and trade-offs, then waits |
| `/approve` | `/approve #9` | PR: agent merges it once CI is green. Decision: recorded in DECISIONS.md |
| `/reject` | `/reject #11 too expensive` | Agent closes the PR or drops the proposal |
| `/status` | `/status` | Heartbeat sent right away |
| `/pause`, `/resume` | `/pause` | Stops or restarts autonomous work |

Only comments from @ArekSahal and @Yolkem23 count as commands. If you two disagree, the agents wait for you to agree.

### What agents do alone, and what waits for you
- **On their own:** plan work, open issues, write code in branches, open PRs, run reviews, publish test builds,
  change the database (always saved as a migration).
- **Waits for you:** merging to `main`, new paid services or API keys, anything touching user data or privacy,
  marketplace/payment rules, changes to the tech stack.

You can merge a PR yourself on GitHub, or comment `/approve #N` and the agent merges it.
