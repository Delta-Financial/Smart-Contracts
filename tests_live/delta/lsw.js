const { getLatestBlock, getContractAtOrDeploy, getContractAtOrDeployNoMine } = require("../utils");
const { advanceTimeAndBlock } = require('../timeHelpers');
const { DELTA_MULTI_SIG_ADDRESS, ROUTER_ADDRESS } = require("../constants");
const { constants } = require('@openzeppelin/test-helpers');
const { mainnet } = require("../config");

const DeltaRouter = artifacts.require('DeltaRouter');

const secondsInADay = 24 * 60 * 60;
const fiveMinutesInSeconds = 5 * 60;
const DELTA_TOTAL_SUPPLY = "45000000000000000000000000";

const safeAdvanceBlockTime = async time => {
  const blockBefore = await getLatestBlock();
  const blockAfter = await advanceTimeAndBlock(time);
  expect(blockAfter.timestamp - blockBefore.timestamp).to.be.gte(time);

  return parseInt(blockAfter.timestamp.toString());
};

const safeAdvanceToLdeEnd = async (lsw, offset = fiveMinutesInSeconds) => {
  expect(await lsw.liquidityGenerationHasEnded()).to.be.false;
  expect(await lsw.refundsOpen()).to.be.false;

  const currentTmestamp = (await getLatestBlock()).timestamp;
  const ldeEndTimestamp = parseInt(await lsw.liquidityGenerationEndTimestamp());

  const timediff = ldeEndTimestamp - currentTmestamp + offset;
  expect(timediff).to.be.gte(0,"block timestamp is post LGE end time, advance block propably bro search     await resertFork(12055723);");

  await safeAdvanceBlockTime(timediff);
};

const endLSW = async (lsw, delta, rlp, dfv, weth, reserve, showReport = false, noMine = false) => {
  totalWeth = await weth.balanceOf(lsw.address);
  totalWethBonuses = await lsw.totalWETHEarmarkedForReferrers();
  const deployFn = noMine ? getContractAtOrDeployNoMine : getContractAtOrDeploy;

  expect(await delta.balanceOf(lsw.address)).to.be.bignumber.equal(DELTA_TOTAL_SUPPLY);

  await safeAdvanceToLdeEnd(lsw);
  await lsw.endLiquidityDeployment({ from: mainnet.addresses.coreMultisig });
  expect(await lsw.liquidityGenerationHasEnded()).to.be.true;

  const deltaWethPairAddress = await rlp.deltaxWethPair();
  expect(deltaWethPairAddress).to.not.be.equal(constants.ZERO_ADDRESS);

  const UniswapV2Pair = artifacts.require('UniswapV2Pair');
  deltaWethPair = await UniswapV2Pair.at(deltaWethPairAddress);

  await expectAllFundsDistributedCorrectly(totalWeth, totalWethBonuses, delta, deltaWethPair, reserve, rlp, showReport);


  router = await deployFn(ROUTER_ADDRESS, DeltaRouter, delta.address, deltaWethPairAddress, dfv.address, rlp.address, { from: mainnet.addresses.coreMultisig });

  if (!process.env.IS_PRODUCTION) {
    await delta.setWhitelists(router.address, true, true, true, { from: DELTA_MULTI_SIG_ADDRESS });
  } else {
    expect(await router.deltaToken()).to.be.equal(delta.address);
    expect(await router.deltaWethPair()).to.be.equal(deltaWethAddress);
    expect(await router.deepFarmingVault()).to.be.equal(dfv.address);
    expect(await router.rebasingToken()).to.be.equal(rlp.address);
  }

  return {
    router,
    deltaWethPair
  };
};

const expectAllFundsDistributedCorrectly = async (totalWeth, totalWethBonuses, delta, deltaWethUniswapPair, reserveVault, rlp, showReport = false) => {
  expect(totalWeth).to.not.be.undefined;
  expect(totalWethBonuses).to.not.be.undefined;

  totalWeth = totalWeth.toString() / 1e18;

  const ethPriceInUsd = 1500;
  const maxEthForPool = 1500;
  const totalDelta = 45000000;

  /*
    Multisig should have 50% of tokens and WETH
    Reserve should have 50% - 1500 equivalent in ETH of DELTA and about 45% - 1500 ETH
    Pair should have 1500 ETH and equivalent in DELTA from the same ratio
  */
  expect(deltaWethUniswapPair).to.not.be.undefined;
  const halfWeth = totalWeth / 2;
  const halfDelta = totalDelta / 2;
  const wethPostReferral = halfWeth - (totalWethBonuses.toString() / 1e18);
  const wethForReserve = wethPostReferral - maxEthForPool;

  // Check team Weth & Delta Share
  const teamDeltaBalance = await delta.balanceOf(DELTA_MULTI_SIG_ADDRESS);
  const teamWethBalance = (await weth.balanceOf(DELTA_MULTI_SIG_ADDRESS)).toString() / 1e18;

  // reserve get the 50% of weth - 1500 and same ratio as 50% of the whole delta supply
  const reserveWethBalance = (await weth.balanceOf(reserveVault.address)).toString() / 1e18;
  const reserveDeltaBalance = (await delta.balanceOf(reserveVault.address)).toString() / 1e18;

  if (showReport) {
    console.log('DELTA_PER_ONE_WHOLE_ETH: ', (await reserveVault.DELTA_PER_ONE_WHOLE_ETH()).toString());
  }

  // reserve0 is delta, reserve1 is weth
  const { _reserve0, _reserve1 } = await deltaWethUniswapPair.getReserves();
  const pairDeltaBalance = _reserve0.toString() / 1e18;
  const pairWethBalance = _reserve1.toString() / 1e18;

  const deltaPriceInEthInPair = pairWethBalance / pairDeltaBalance;
  const deltaPriceInEthInReserve = reserveWethBalance / reserveDeltaBalance;

  // team shake + marketing
  const teamAndMarketingShare = 0.19;
  const circulatingDelta = teamAndMarketingShare * totalDelta;

  const rLPTotalSupply = (await rlp.totalSupply()) / 1e18;;
  const univ2TotalSupply = (await deltaWethUniswapPair.totalSupply()) / 1e18;
  const totalCreditValue = (await lsw.totalCreditValue()) / 1e18;
  const creditToRlpRatio = rLPTotalSupply / totalCreditValue;

  if (showReport) {
    console.log('');
    console.log('============================== LSW REPORT  ==============================');
    console.log('🤖 End LSW Stats 🤖');
    console.log(` • ${totalWeth.toLocaleString()} ETH contributed`);
    console.log(` • ${(totalWethBonuses.toString() / 1e18).toLocaleString()} ETH allocated for referral bonuses`);
    console.log('   ----------------------------------------------------------------------');
    console.log(` • Pool Has ${pairDeltaBalance.toLocaleString()} DELTA / ${pairWethBalance.toLocaleString()} wETH`);
    console.log(` • Reserve Has ${reserveDeltaBalance.toLocaleString()} DELTA / ${reserveWethBalance.toLocaleString()} wETH`);
    console.log(` • Delta Team Has ${(teamDeltaBalance.toString() / 1e18).toLocaleString()} DELTA / ${teamWethBalance.toLocaleString()} wETH`);
    console.log('   ----------------------------------------------------------------------');
    console.log(` • Pool Ratio (wETH/DELTA): 1 DELTA = ${deltaPriceInEthInPair.toFixed(8)} wETH`);
    console.log(` • Reserve Ratio (wETH/DELTA): 1 DELTA = ${deltaPriceInEthInReserve.toFixed(8)} wETH`);
    console.log('   ----------------------------------------------------------------------');
    console.log(` • Delta Price In Pool $${(deltaPriceInEthInPair * ethPriceInUsd).toFixed(4).toLocaleString()}`);
    console.log(` • Delta Price In Reserve $${(deltaPriceInEthInReserve * ethPriceInUsd).toFixed(4).toLocaleString()}`);
    console.log('   ----------------------------------------------------------------------');
    console.log(` • Fully Diluted Market Cap: $${(totalDelta * deltaPriceInEthInPair * ethPriceInUsd).toLocaleString()} (${totalDelta.toLocaleString()} DELTA)`);
    console.log(` • Uniswap Market Cap: $${(pairDeltaBalance * deltaPriceInEthInPair * ethPriceInUsd).toLocaleString()} (${pairDeltaBalance.toLocaleString()} DELTA)`);
    console.log(` • Circulating Market Cap: $${(circulatingDelta * deltaPriceInEthInPair * ethPriceInUsd).toLocaleString()} (${circulatingDelta.toLocaleString()} DELTA)`);
    console.log('   ----------------------------------------------------------------------');
    console.log(` • rLP total supply: ${rLPTotalSupply}`);
    console.log(` • univ2 total supply: ${univ2TotalSupply}`);
    console.log(` • totalCreditValue: ${totalCreditValue} credits`);
    console.log(` • 1 credit = ${creditToRlpRatio} rLP`);
    console.log('');
    console.log(`   * Prices are calculated with ETH @ $${ethPriceInUsd}`);
    console.log('=========================================================================');
    console.log('');
  }

  expect(teamDeltaBalance).to.be.bignumber.equal('22500000000000000000000000');
  expect(teamWethBalance).to.be.equal(halfWeth);
  expect(pairWethBalance).to.be.equal(maxEthForPool);

  // Check vault ratio is same as reserve ratio
  const differenceInPercent = Math.abs((deltaPriceInEthInPair - deltaPriceInEthInReserve) / deltaPriceInEthInPair);
  // tolerate 2% imbalance
  expect(differenceInPercent).to.be.lte(0.02);

  const remainingDeltaReserve = halfDelta - pairDeltaBalance;

  // Compare with epsilon since float are not the same precision as the solidity calculation
  expect(Math.abs(reserveWethBalance - wethForReserve)).to.be.lt(0.001);
  expect(Math.abs(reserveDeltaBalance - remainingDeltaReserve)).to.be.lt(0.001);

  // Only the weth for bonus claim should remain in the contract at the end.
  expect(await delta.balanceOf(lsw.address)).to.be.bignumber.equal('0');
  expect(await weth.balanceOf(lsw.address)).to.be.bignumber.equal(totalWethBonuses);
};


module.exports = {
  endLSW
};
