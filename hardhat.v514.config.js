require("@nomiclabs/hardhat-truffle5");
require('hardhat-log-remover');

module.exports = {
  solidity: {
    version: "0.5.14+commit.1f1aaa4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 99999
      },
      outputSelection: {
        "*": {
          "": ["ast"],
          "*": ["storageLayout"]
        },
      }
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      settings: {
        evmVersion: "byzantium"
      }
    },
  },
  paths: {
    sources: "./contracts/v612/DELTA/Periphery/Vaults/Withdrawal",
  }
};
