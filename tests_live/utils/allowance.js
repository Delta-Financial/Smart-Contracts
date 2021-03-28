const { MAX_UINT256 } = require('@openzeppelin/test-helpers/src/constants');
const { artifacts } = require('hardhat');
const { impersonate } = require('./impersonate');
const IERC20 = artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');

const approve = async (accountAddress, tokenAddress, contractAddress, amount = MAX_UINT256) => {
  const token = await IERC20.at(tokenAddress);
  await token.approve(contractAddress, amount, {
    from: accountAddress,
    gas: 0,
    gasPrice: 0
  })
};

module.exports = {
  approve
};
