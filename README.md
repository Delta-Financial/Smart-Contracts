# Live Contracts

Delta Reserve Vault
[https://etherscan.io/address/0x6b29a3f9a1e378a57410dc480c1b19f4f89de848](https://etherscan.io/address/0x6b29a3f9a1e378a57410dc480c1b19f4f89de848)

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
