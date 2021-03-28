const { artifacts, expect } = require('hardhat');
const constants = require('@openzeppelin/test-helpers/src/constants');
const { mainnet } = require('../config');
const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const { impersonate, stopImpersonate } = require('./impersonate');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const IERC20 = artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
const IUniswapV2Factory = artifacts.require('@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol:IUniswapV2Factory');
const IUniswapV2Pair = artifacts.require('@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair');
const ethers = require('ethers');
const UniswapV2PairArtifact = require('../../uniswap-artifacts/UniswapV2Pair.json');

/**
 * 
 * Takes tokens from a uniswap pair and transfer it to the specified destination address.
 * Note that till
 */
const addBalancesFromPairToAccount = async (uniswapPairAddress, tokenAddress, accountAddress, amount, autoImpersonate = true) => {
  if (!web3.utils.isAddress(uniswapPairAddress)) throw new TypeError('uniswapPairAddress is not a valid address');
  if (!web3.utils.isAddress(tokenAddress)) throw new TypeError('tokenAddress is not a valid address');
  if (!web3.utils.isAddress(accountAddress)) throw new TypeError('accountAddress is not a valid address');

  if (autoImpersonate) {
    await impersonate(uniswapPairAddress);
  }

  const token = await IERC20.at(tokenAddress);

  await token.approve(accountAddress, amount, {
    from: uniswapPairAddress,
    gas: 0,
    gasPrice: 0
  });

  await token.transfer(accountAddress, amount, {
    from: uniswapPairAddress,
    gas: 0,
    gasPrice: 0
  });

  const pair = await IUniswapV2Pair.at(uniswapPairAddress);
  await pair.sync();

  if (autoImpersonate) {
    await stopImpersonate(uniswapPairAddress);
  }

  console.warn('WARNING: addBalancesFromPairToAccount was used. This changes the uniswap pair balance and affecting the price.')
};

const createUniswapPair = async (account, token0Address, token1Address, amount0, amount1, autoImpersonate = true) => {
  if (!web3.utils.isAddress(account)) throw new TypeError('account is not a valid address');
  if (!web3.utils.isAddress(token0Address)) throw new TypeError('token0Address is not a valid address');
  if (!web3.utils.isAddress(token1Address)) throw new TypeError('token1Address is not a valid address');

  if (autoImpersonate) {
    await impersonate(account);
  }

  const token0 = await IERC20.at(token0Address);
  const token1 = await IERC20.at(token1Address);

  const uniswapFactory = await IUniswapV2Factory.at(mainnet.addresses.uniswapV2Factory);

  const existingPairAddress = await uniswapFactory.getPair(token0Address, token1Address);

  if (existingPairAddress !== constants.ZERO_ADDRESS) {
    throw new Error('Pair already exist');
  }

  const receipt = await uniswapFactory.createPair(token0Address, token1Address, { from: account });
  expectEvent(receipt, 'PairCreated');
  const pairAddress = receipt.logs[0].args.pair;

  await token0.transfer(pairAddress, amount0, { from: account });
  await token1.transfer(pairAddress, amount1, { from: account });

  const pair = await IUniswapV2Pair.at(pairAddress);
  await pair.mint(account, { from: account });

  const univ2Balance = await pair.balanceOf(account);

  if (univ2Balance.isZero()) {
    throw new Error('Failed to mint the uniswap token to the account');
  }

  if (autoImpersonate) {
    await stopImpersonate(account);
  }

  return {
    address: pairAddress,
    token0: (await pair.token0()),
    token1: (await pair.token1()),
    pair
  };
};

const transferTokenFromPair = async (account, tokenAddress, pairAddress, amount) => {
  if (!web3.utils.isAddress(account)) throw new TypeError('account is not a valid address');
  if (!web3.utils.isAddress(tokenAddress)) throw new TypeError('tokenAddress is not a valid address');
  if (!web3.utils.isAddress(pairAddress)) throw new TypeError('pairAddress is not a valid address');

  const token = await IERC20.at(tokenAddress);
  await addBalancesFromPairToAccount(pairAddress, tokenAddress, account, amount);
  expect(await token.balanceOf(account)).to.be.bignumber.equal(amount);
};

/**
 * Simple swap that just transfer tokenIn amount in the pair
 * and get whatever equivalent tokenOut amount.
 * 
 * Used to get tokens from a pair when it's not important how
 * much we receive.
 */
// WIP
const swap = async (acount, tokenAddress, tokenAmount, pairAddress) => {
  if (!web3.utils.isAddress(account)) throw new TypeError('account is not a valid address');
  if (!web3.utils.isAddress(tokenAddress)) throw new TypeError('tokenAddress is not a valid address');
  if (!web3.utils.isAddress(pairAddress)) throw new TypeError('pairAddress is not a valid address');

  const pair = await IUniswapV2Pair.at(pairAddress);
  expect(pair.address).to.be.equal(pairAddress);

  const token0 = await pair.token0();
  const token1 = await pair.token1();

  const token = await IERC20.at(tokenAddress);
  
  if (tokenAddress === token0) {
    //await token.transfer(pairAddress, tokenAmount.toString(), { from: account });
  } else if (tokenAddress === token1) {

  } else {
    throw new Error('The given tokenAddress is not in the given pair');
  }
};

const getCreate2Address = (tokenA, tokenB) => {
  const factoryAddress = mainnet.addresses.uniswapV2Factory;
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]
  const bytecode = `0x${UniswapV2PairArtifact.evm.bytecode.object}`;
  const create2Inputs = [
    '0xff',
    factoryAddress,
    ethers.utils.keccak256(ethers.utils.solidityPack(['address', 'address'], [token0, token1])),
    ethers.utils.keccak256(bytecode)
  ]
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`
  return ethers.utils.getAddress(`0x${ethers.utils.keccak256(sanitizedInputs).slice(-40)}`)
};

module.exports = {
  addBalancesFromPairToAccount,
  createUniswapPair,
  transferTokenFromPair,
  getCreate2Address
};
