require("@nomiclabs/hardhat-truffle5");
require('hardhat-log-remover');

module.exports = {
  solidity: {
    version: "0.4.24",
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
    sources: "./contracts/v424",
  }
};
