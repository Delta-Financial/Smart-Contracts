# BUG BOUNTY LIVE - March 8, 2021 00:00:00 UTC

## What's includes in the bug bounty?

Only files including the comment:

```
// DELTA-BUG-BOUNTY
```

## How do I run tests?

First search and replaced `ALCHEMY_API` references with your API key.
Then:

```
./liveTest.sh --token tests_live/delta/delta_token.js
```