# CI workflow

GitHub OAuth token on this machine lacks the `workflow` scope, so
`.github/workflows/ci.yml` cannot be pushed directly. Once a token with
`workflow` scope is available:

    mkdir -p .github/workflows && cp docs/ci.yml .github/workflows/ci.yml
    git add .github/workflows/ci.yml && git commit -m "ci: enable" && git push

The workflow runs typecheck, drizzle push, and the full test matrix on
Postgres 15 for every push to main.
