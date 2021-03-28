require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ethers");
//require('@eth-optimism/smock/build/src/plugins/hardhat-storagelayout');
require('hardhat-log-remover');
require('./tasks');
// require("hardhat-gas-reporter");
require("hardhat-tracer");

module.exports = {
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "": ["ast"],
          "*": ["storageLayout", "evm.gasEstimates"]
        },
      }
    }
  },
  paths: {
    sources: "./contracts/v612",
  },
  defaultNetwork: "hardhat",
  networks: {
    /* Use this config when using Uniswap Exchange

    hardhat: {
      chainId: 1,
      accounts: {
        mnemonic: "lift pottery popular bid consider dumb faculty better alpha mean game attack",
        accountsBalance: "100000000000000000000000"
      },
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
      }
    }
    
    */
    hardhat: {
      chainId: 1,
      allowUnlimitedContractSize: true,
      gasLimit: 0x1fffffffffffff,
      //blockGasLimit: 0x1fffffffffffff,
      callGasLimit: "0x1fffffffffffff",
      gasPrice: 0,
      accounts: {
        mnemonic: "lift pottery popular bid consider dumb faculty better alpha mean game attack",
        accountsBalance: "100000000000000000000000"
      },
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
        // url: "http://192.168.1.100:8545",
        // blockNumber: 11766427
      }
    }
  },
  mocha: {
    timeout: 99999999,
    bail: true
  }
};