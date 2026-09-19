# Agent notes

## Package tests

Run package tests from the repository root:

```sh
npx vitest run packages/<package>
```

The npm workspace test command can exit successfully without finding tests. Confirm that the result reports executed tests; exit status alone is not verification.
