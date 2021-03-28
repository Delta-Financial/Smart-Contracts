# BUG BOUNTY LIVE - March 8, 2021 00:00:00 UTC

## What's includes in the bug bounty?

Only files including the comment:

```
// DELTA-BUG-BOUNTY
```

In particular, we recommend reviewing the two major user entry points as they include the rest of the code:

### The Delta Token

https://github.com/Delta-Financial/Smart-Contracts/blob/master/contracts/v076/DELTAToken.sol

### The Deep Farming Vault

https://github.com/Delta-Financial/Smart-Contracts/blob/master/contracts/v076/Periphery/Vaults/DELTA_Deep_Farming_Vault.sol


## How do I run tests?

### Set up your environment and install dependencies

Set a local environment variable `ALCHEMY_API_KEY` to a valid Alchemy API key. Create one here: [https://docs.alchemyapi.io/alchemy/guides/getting-started](https://docs.alchemyapi.io/alchemy/guides/getting-started)
Then:

```
yarn # Only needed once
./build.sh # Only needed once
```

### Then run a test:

```
# Test the Delta token
./liveTest.sh --token tests_live/delta/delta_token.test.js
```

```
# Test the Deep Farming Vault
./liveTest.sh --token tests_live/delta/dfv.test.js
```
