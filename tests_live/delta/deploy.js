const { mainnet } = require("../config");
const {
  RESERVE_ADDRESS,
  DELTA_MULTI_SIG_ADDRESS,
  LSW_ADDRESS,
  RLP_ADDRESS,
  DFV_ADDRESS,
  DISTRIBUTOR_ADDRESS,
  DELTA_ADDRESS,
  WITHDRAWAL_PROXY_ADDRESS,
  WITHDRAWAL_MASTER_COPY_ADDRESS,
  ROUTER_ADDRESS
} = require("../constants");

const {
  getBlockNumber,
  getCreate2Address,
  impersonate,
  getContractAtOrDeploy,
  getContractAtOrDeployNoMine,
  isContractDeployed
} = require('../utils');

const { constants } = require('@openzeppelin/test-helpers');
const { expect } = require("hardhat");
const { endLSW } = require("./lsw");

const verbose = true;

/**
 * Default parameters for deployDeltaContracts
 */
const defaultParameters = {
  endLsw: true,
  showEndLSWReport: false,
  activatePostFirstRebasingState: true,
  startFarming: true,
  noMineMode: false
};

const deployDeltaContracts = async (parameters = {}) => {
  parameters = {
    ...defaultParameters,
    ...parameters
  };

  const deployFn = parameters.noMineMode ? getContractAtOrDeployNoMine : getContractAtOrDeploy;

  const LSW = artifacts.require('DELTA_Limited_Staking_Window');
  const DeepFarmingVault = artifacts.require('DELTA_Deep_Farming_Vault');
  const RebasingLiquidityToken = artifacts.require("DELTA_Rebasing_Liquidity_Token");
  const DeltaToken = artifacts.require("DELTAToken");
  const ReserveVault = artifacts.require('DELTA_Reserve_Vault');
  const Distributor = artifacts.require('DELTA_Distributor');
  const IWETH = artifacts.require('WETH9');
  const ProxyFactory = artifacts.require('ProxyFactory');
  const WithdrawalMasterCopy = artifacts.require('DELTA_Deep_Vault_Withdrawal');
  const UniswapV2Pair = artifacts.require('UniswapV2Pair');
  const GnosisSafe = artifacts.require("GnosisSafe");

  await impersonate(mainnet.addresses.coreMultisig);
  await impersonate(DELTA_MULTI_SIG_ADDRESS);

  weth = await IWETH.at(mainnet.addresses.wETH);
  teamWethBeforeLde = await weth.balanceOf(DELTA_MULTI_SIG_ADDRESS);
  lsw = await LSW.at(LSW_ADDRESS);

  /**
   * DELTA contract deployments / configuration
   * 
   * Uses real addresses when IS_PRODUCTION flag is true, otherwize deploy an instance
   */

  const proxyFactory = await deployFn(WITHDRAWAL_PROXY_ADDRESS, ProxyFactory);
  const withdrawalMasterCopy = await deployFn(WITHDRAWAL_MASTER_COPY_ADDRESS, WithdrawalMasterCopy);
  const reserve = await deployFn(RESERVE_ADDRESS, ReserveVault, { from: DELTA_MULTI_SIG_ADDRESS });
  const rlp = await deployFn(RLP_ADDRESS, RebasingLiquidityToken, reserve.address, { from: mainnet.addresses.coreMultisig });
  const dfv = await deployFn(DFV_ADDRESS, DeepFarmingVault, proxyFactory.address, withdrawalMasterCopy.address, rlp.address, { from: mainnet.addresses.coreMultisig });

  let delta;

  // Deploy Delta Token
  while (!delta) {
    try {
      console.log("trying")
      delta = await deployFn(DELTA_ADDRESS, DeltaToken, rlp.address, DELTA_MULTI_SIG_ADDRESS, dfv.address, { from: mainnet.addresses.coreMultisig });
    }
    catch (e) {
      await weth.deposit({
        from: mainnet.addresses.coreMultisig,
        value: '123'
      }); // dummy tx to advance the nounce
      if(verbose) {
        console.log(`bad delta address, try again...${e.message}`);
      }
    }
  }
  console.log("dfv.test.js deployDeltaContracts() aa6");

  // we set delta on the dfv. Its either setting it on token or this on that 
  // but this should be called less so we set it here to conserve gas
  await dfv.setDelta(delta.address, {from : mainnet.addresses.coreMultisig })

  expect(await delta.name()).to.be.equal('DELTA.financial - deep DeFi derivatives');
  expect(await delta.symbol()).to.be.equal('DELTA');
  expect(await delta.decimals()).to.be.bignumber.equal('18');
  expect(await delta.totalSupply()).to.be.bignumber.equal('45000000000000000000000000');
  expect(await delta.balanceOf(delta.address)).to.be.bignumber.equal('0');

  const distributor = await deployFn(DISTRIBUTOR_ADDRESS, Distributor, delta.address, { from: mainnet.addresses.coreMultisig });

  // self authorised
  const gnosisSafe = await GnosisSafe.at(DELTA_MULTI_SIG_ADDRESS);
  await gnosisSafe.enableModule(dfv.address, { from: DELTA_MULTI_SIG_ADDRESS })

  if(parameters.startFarming) {
    await dfv.startFarming({ from: DELTA_MULTI_SIG_ADDRESS });
  }

  // Assigned the required components to end the LSW
  await lsw.setDELTAToken(delta.address, false, { from: DELTA_MULTI_SIG_ADDRESS });
  await lsw.setRLPWrap(rlp.address, { from: DELTA_MULTI_SIG_ADDRESS });
  await lsw.setReserveVault(reserve.address, { from: DELTA_MULTI_SIG_ADDRESS });
  await lsw.setFarmingVaultAddress(dfv.address, { from: DELTA_MULTI_SIG_ADDRESS });

  const deltaWethAddress = await distributor.DELTA_WETH_PAIR_UNISWAP()
  expect(await distributor.DELTA_TOKEN()).to.be.equal(delta.address);
  expect(deltaWethAddress).to.not.be.equal(constants.ZERO_ADDRESS);

  if (!process.env.IS_PRODUCTION) {
    await distributor.setDeepFarmingVault(dfv.address, { from: DELTA_MULTI_SIG_ADDRESS });
    await reserve.setupDeltaToken(delta.address, { from: DELTA_MULTI_SIG_ADDRESS });
    await delta.setDistributor(distributor.address, { from: DELTA_MULTI_SIG_ADDRESS });
    await delta.setNoVestingWhitelist(dfv.address, true, { from: DELTA_MULTI_SIG_ADDRESS });
  } else {
    const dfvInfo = await delta.userInformation(dfv.address);
    await assert(dfvInfo.fullSenderWhitelisted && dfvInfo.immatureReceiverWhitelisted && dfvInfo.noVestingWhitelisted, "DFV did not get permissions when it should");
    expect(await dfv.address).to.not.be.equal(constants.ZERO_ADDRESS);
    expect(await dfv.WITHDRAWAL_PROXY_FACTORY()).to.be.equal(proxyFactory.address);
    expect(await dfv.WITHDRAWAL_CONTRACT_MASTERCOPY()).to.be.equal(withdrawalMasterCopy.address);
    expect(await dfv.DELTA()).to.be.equal(delta.address);
    expect(await dfv.RLP()).to.be.equal(rlp.address);

    expect(await distributor.setDeepFarmingVault()).to.not.be.equal(constants.ZERO_ADDRESS);
    expect(await reserve.deltaToken()).to.not.be.equal(constants.ZERO_ADDRESS);
    expect(await delta.distributor()).to.not.be.equal(constants.ZERO_ADDRESS);
    expect(await delta.rebasingLPAddress()).not.to.be.equal(constants.ZERO_ADDRESS);
    expect(await rlp.deltaxWethPair()).to.not.be.equal(constants.ZERO_ADDRESS);
    expect(await rlp.delta()).to.not.be.equal(constants.ZERO_ADDRESS);
  }

  const deltaWethPairAddress = getCreate2Address(delta.address, mainnet.addresses.wETH);

  let deltaWethPair;
  let router;

  if (parameters.endLsw) {
    if(verbose) {
      console.log('Ending LSW...');
    }

    ({ router, deltaWethPair } = await endLSW(lsw, delta, rlp, dfv, weth, reserve, parameters.showEndLSWReport));
    expect(await isContractDeployed(deltaWethPairAddress)).to.be.true;

    if (!process.env.IS_PRODUCTION) {
      await delta.setWhitelists(router.address, true, true, true, { from: DELTA_MULTI_SIG_ADDRESS });
    } else {
      expect((await delta.userInformation(router.address)).noVestingWhitelisted).to.be.true;
      expect(await router.deltaToken()).to.be.equal(delta.address);
      expect(await router.deltaWethPair()).to.be.equal(deltaWethAddress);
      expect(await router.deepFarmingVault()).to.be.equal(dfv.address);
      expect(await router.rebasingToken()).to.be.equal(rlp.address);
    }
  }

  if (process.env.IS_PRODUCTION) {
    expect((await delta.userInformation(router.address)).noVestingWhitelisted).to.be.true;
  }

  if(parameters.activatePostFirstRebasingState) {
    await delta.activatePostFirstRebasingState({ from: DELTA_MULTI_SIG_ADDRESS });
  }
  
  if(verbose) {
    console.log(`RESERVE_ADDRESS: "${reserve.address}",`);
    console.log(`DFV_ADDRESS: "${dfv.address}",`);
    console.log(`RLP_ADDRESS: "${rlp.address}",`);
    console.log(`DELTA_ADDRESS: "${delta.address}",`);
    console.log(`DISTRIBUTOR_ADDRESS: "${distributor.address}",`);
    console.log(`WITHDRAWAL_PROXY_ADDRESS: "${proxyFactory.address}",`);
    console.log(`WITHDRAWAL_MASTER_COPY_ADDRESS: "${withdrawalMasterCopy.address}",`);
    console.log('');
    console.log('block number:', await getBlockNumber());
  }

  return {
    dfv,
    lsw,
    rlp,
    delta,
    reserve,
    router,
    distributor,
    proxyFactory,
    deltaWethPair,
    withdrawalMasterCopy,
    gnosisSafe
  }
};

module.exports = {
  deployDeltaContracts,
};
