const { BN } = require("@openzeppelin/test-helpers/src/setup");
const { getLatestBlock } = require('../utils/fork');

const addSlippage = (minAmount, perMileSlippage) => {
  minAmount = new BN(minAmount);
  perMileSlippage = new BN(perMileSlippage);

  const slippageAmount = minAmount.mul(perMileSlippage).div(new BN('1000'));

  return minAmount.sub(slippageAmount).toString();
};

const mintRlpWithEth = async (account, ethAmount, config, stake = false, slippagePerMile = 3) => {
  const { rlp, router } = config();
  const rlpBalanceBefore = await rlp.balanceOf(account);

  let minLpAmount = (await router.getLPTokenPerEthUnit(ethAmount.toString())).toString();
  minLpAmount = addSlippage(minLpAmount, slippagePerMile);

  await router.addLiquidityETHOnly(minLpAmount, stake, { from: account, value: ethAmount.toString() });
  const rlpBalanceAfter = await rlp.balanceOf(account);
  const mintedAmount = rlpBalanceAfter.sub(rlpBalanceBefore);

  if (stake) {
    expect(mintedAmount).to.be.bignumber.equal('0');
  } else {
    expect(mintedAmount).to.be.bignumber.gte(minLpAmount.toString());
  }

  return mintedAmount;
};

const mintRlpWithEthAndDelta = async (account, deltaAmount, ethAmount, config, stake = false, slippagePerMile = 3) => {
  const { rlp, router } = config();
  const rlpBalanceBefore = await rlp.balanceOf(account);
  const minLpAmount = (await router.getLPTokenPerBothSideUnits(deltaAmount, ethAmount)).toString();

  await approve(account, delta.address, router.address, MAX_UINT256, false);
  await router.addLiquidityBothSides(deltaAmount, minLpAmount, stake, { from: account, value: ethAmount.toString() });

  const rlpBalanceAfter = await rlp.balanceOf(account);
  const mintedAmount = rlpBalanceAfter.sub(rlpBalanceBefore);

  expect(mintedAmount).to.be.bignumber.gte(minLpAmount.toString());

  return mintedAmount;
};


const getDeltaOutForEth = async (ethAmount, deltaWethPair, uniswapRouter) => {
  const { _reserve0: deltaReserve, _reserve1: wethReserve } = await deltaWethPair.getReserves();
  return uniswapRouter.getAmountOut(ethAmount, wethReserve, deltaReserve);
};

const getEthOutForDelta = async (deltaAmount, deltaWethPair, uniswapRouter) => {
  const { _reserve0: deltaReserve, _reserve1: wethReserve } = await deltaWethPair.getReserves();
  return uniswapRouter.getAmountOut(deltaAmount, deltaReserve, wethReserve);
};

const swapDeltaForEth = async (account, weth, deltaAmount, delta, deltaWethPair, uniswapRouter) => {
  const ethAmount = await swapDeltaForWeth(account, weth, deltaAmount, delta, deltaWethPair, uniswapRouter);

  await weth.withdraw(ethAmount, {
    from: account
  });

  return ethAmount;
};

const swapEthForDelta = async (account, ethAmount, weth, delta, deltaWethPair, uniswapRouter) => {
  await weth.deposit({
    from: account,
    value: ethAmount
  });
  return swapWethForDelta(account, ethAmount, weth, delta, deltaWethPair, uniswapRouter);
};

const swapDeltaForWeth = async (account, weth, deltaAmount, delta, deltaWethPair, uniswapRouter) => {
  deltaAmount = new BN(deltaAmount);
  const balanceBefore = await weth.balanceOf(account);
  const ethAmount = await getEthOutForDelta(deltaAmount, deltaWethPair, uniswapRouter);

  await delta.transfer(deltaWethPair.address, deltaAmount, { from: account });
  await deltaWethPair.swap(0, ethAmount, account, "0x");

  const balanceAfter = await weth.balanceOf(account);
  const wethAmountReceived = balanceAfter.sub(balanceBefore);

  console.log(`Swapped ${deltaAmount.toString() / 1e18} DELTA for ${wethAmountReceived.toString() / 1e18} wETH`);
  expect(wethAmountReceived).to.be.bignumber.gt("0");

  return wethAmountReceived;
};

const swapWethForDelta = async (account, wethAmount, weth, delta, deltaWethPair, uniswapRouter) => {
  wethAmount = new BN(wethAmount);
  const balanceBefore = await delta.balanceOf(account);
  const deltaAmount = await getDeltaOutForEth(wethAmount, deltaWethPair, uniswapRouter);

  await weth.transfer(deltaWethPair.address, wethAmount, { from: account });
  await deltaWethPair.swap(deltaAmount, 0, account, "0x");

  const balanceAfter = await delta.balanceOf(account);
  const deltaAmountReceived = balanceAfter.sub(balanceBefore);

  console.log(`Swapped ${wethAmount.toString() / 1e18} wETH for ${deltaAmountReceived.toString() / 1e18} DELTA (balance)`);
  expect(deltaAmountReceived).to.be.bignumber.gt("0");

  return deltaAmountReceived;
};

const mintLpWithUniswapRouter = async (account, ethAmount, deltaAmount, weth, deltaWethPair, uniswapRouter) => {
  if (!web3.utils.isAddress(account)) throw new TypeError('account is not a valid address');
  if (!ethAmount) throw new TypeError('ethAmount is mandatory');

  ethAmount = new BN(ethAmount);
  if (deltaAmount) {
    deltaAmount = new BN(deltaAmount);
  }

  const balanceBefore = await deltaWethPair.balanceOf(account);
  await weth.deposit({
    from: account,
    value: ethAmount
  });

  let lpEthAmount = ethAmount;
  let lpDeltaAmount = deltaAmount;

  // Eth only
  if (ethAmount && !deltaAmount) {
    lpEthAmount = ethAmount.div(new BN("2"));
    lpDeltaAmount = await getDeltaOutForEth(lpEthAmount, deltaWethPair, uniswapRouter);
    await delta.transfer(account, lpDeltaAmount, { from: DELTA_MULTI_SIG_ADDRESS });
  }

  const deadline = (await getLatestBlock()).timestamp + 999999;
  await uniswapRouter.addLiquidity(delta.address, weth.address, lpDeltaAmount, lpEthAmount, 0, 0, account, deadline);

  const balanceAfter = await deltaWethPair.balanceOf(account);
  const amountLpReceived = balanceAfter.sub(balanceBefore);

  console.log(`Minted ${amountLpReceived.toString() / 1e18} LP (${lpDeltaAmount.toString() / 1e18} DELTA / ${lpEthAmount.toString() / 1e18} wETH)`);

  expect(amountLpReceived).to.be.bignumber.gt("0");
};

module.exports = {
  mintRlpWithEth,
  mintRlpWithEthAndDelta,
  addSlippage,
  mintLpWithUniswapRouter,
  swapWethForDelta,
  swapDeltaForWeth,
  swapEthForDelta,
  swapDeltaForEth
};
