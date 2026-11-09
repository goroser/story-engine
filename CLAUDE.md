# Story Engine — instructions for Claude

MCP server that stores illustrated stories (text chunks plus image prompts). See README.md for tools and setup.

## How to work (Karpathy's four rules)

1. **Think before coding.** State your assumptions and the plan in a few lines. If a request is unclear or two readings are possible, ask instead of guessing.
2. **Keep it simple.** Write the least code that solves the problem. No speculative abstractions, options or layers "for later".
3. **Make surgical changes.** Touch only what the task needs. Don't reformat, rename or refactor unrelated code; mention problems you notice instead of fixing them silently.
4. **Work to a success criterion.** Turn the task into a check you can run (a test, a type check, a script), then loop until it passes. Report what you ran and what's left.

## Checks

- `npm run build` (tsc) must pass. There is no test suite yet: when you change behaviour, add a small runnable check under `scripts/` and run it.
- Never commit keys or `.env` files; Supabase access stays server-side.
- Stories are about a real child: keep personal data out of commits, fixtures and logs.
