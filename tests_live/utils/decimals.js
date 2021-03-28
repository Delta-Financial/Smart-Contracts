const { web3 } = require('hardhat');
const { BN } = require('@openzeppelin/test-helpers');

const timesDecimals = (number, decimals = 18) => {
  return new BN(number).mul(new BN(10).pow(new BN(decimals))).toString()
};

module.exports = {
  timesDecimals,
};
