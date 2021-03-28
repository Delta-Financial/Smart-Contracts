const { mainnet } = require('../config');
const { resetForkAtBlockOrLatestInProduction, impersonate, getLatestBlock, timesDecimals, approve } = require('../utils');
const { mintRlpWithEth, swapEthForDelta, swapDeltaForEth } = require('./delta_utils');

const { advanceTimeAndBlock, getLatestTimestamp } = require('../timeHelpers');
const { takeSnapshot, revertToSnapshot } = require('../snapshot');
const { expectRevert } = require('@openzeppelin/test-helpers');
const { expect, artifacts, assert } = require('hardhat');
const { BN } = require('@openzeppelin/test-helpers/src/setup');
const { deployDeltaContracts } = require('./deploy')
const allConstants = require("../constants");

const { DELTA_MULTI_SIG_ADDRESS, BURN, CORE_MULTISIG } = allConstants;


const IWETH = artifacts.require('WETH9');
const UniswapV2Router02 = artifacts.require("UniswapV2Router02");
const WithdrawalContract = artifacts.require("DELTA_Deep_Vault_Withdrawal")
const ape1 = web3.utils.toChecksumAddress('0x4e9b45b1b16dd4ddb76cf9564563edf2d1ebc41e');
const ape2 = web3.utils.toChecksumAddress('0x5c9fe745f8bb40755eb9fcf8b4fb9d2691618c5e');
const ape3 = web3.utils.toChecksumAddress('0x92fc9ac5baa4abace91f7d7b7f2fe9cf4848c36e');
const ape4 = web3.utils.toChecksumAddress('0x078fe9f57c3419e256851986ecf4c1132a661356');



let dfv,delta,rlp,reserve,weth,router,routerUni,deltaWethPair,distributor,proxyFactory,withdrawalMasterCopy;


function getConfig() {
  return {dfv, delta, rlp, reserve, weth, router,deltaWethPair,routerUni, ape1,ape2,ape3,ape4,distributor,proxyFactory,withdrawalMasterCopy};
}

/**
 * Reset the block number and redeploy the Deep Farming Vault
 */
const verbose = true;
const reset = async () => {
  await resetForkAtBlockOrLatestInProduction(12085991);


  await impersonate(mainnet.addresses.coreMultisig);
  await impersonate(DELTA_MULTI_SIG_ADDRESS);

  weth = await IWETH.at(mainnet.addresses.wETH);
  ({ delta, rlp, distributor, withdrawalMasterCopy, proxyFactory, reserve, deltaWethPair, dfv, router } = await deployDeltaContracts({
    activatePostFirstRebasingState: false
  }));

  const reserves = await deltaWethPair.getReserves();
  routerUni = await UniswapV2Router02.at("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D")
  verbose && console.table({
    initialPairBalances: {
      reserveDELTA: humanRadable(reserves[0]),
      reserveWETH: humanRadable(reserves[1])
    }
  });

  await weth.deposit({ value: wholeUnits(500), from: ape1 })
  await assert(reserves[1].toString() == "1500000000000000000000", "Pair did not get enough weth.") // weth
};

describe('delta / deep farming vault', async () => {
  /**
   * Each test reset the whole node and redeploy the contracts to be sure
   * We starts with a clean state.
   */
  beforeEach(async () => {
    await reset();

    Object.keys(allConstants).forEach(key => {
        hre.tracer.nameTags[allConstants[key]] = `${key}`;
      }
    );


    Object.keys(getConfig()).forEach(key => {
        hre.tracer.nameTags[getConfig()[key].address] = `${key}`;
      }
    );

  });

  

  const buyDELTA = async (amountETH, fromAddress) => {
    //unlock
    await delta.activatePostFirstRebasingState({ from: DELTA_MULTI_SIG_ADDRESS });
    const wethToDelta = [weth.address, delta.address];
    await routerUni.swapExactETHForTokens(amountETH, wethToDelta, fromAddress, "99999999999999999", { from: fromAddress, value: wholeUnits(100) });
  }

  it('test buying and selling and such', async () => {
    const wethToDelta = [weth.address, delta.address];
    const deltaToWeth = [delta.address, weth.address];
    // Get DELTA for APE1
    console.log(hre)

    console.log(hre)

    await weth.approve(routerUni.address, wholeUnits(6966999999969), { from: ape1 });

    // We check that is locked succesfully
    await expectRevert(
      routerUni.swapTokensForExactTokens(wholeUnits(10), wholeUnits(10000), wethToDelta, ape1, "99999999999999999", { from: ape1 })
      , "UniswapV2: TRANSFER_FAILED"
    );

    await weth.approve(routerUni.address, wholeUnits(6966999999969), { from: CORE_MULTISIG });
    await weth.transfer(CORE_MULTISIG, wholeUnits(10), { from: ape1 })
    // We checfk that multisig can transfer even tho its locked
    await routerUni.swapTokensForExactTokens(wholeUnits(10), wholeUnits(10000), wethToDelta, CORE_MULTISIG, "99999999999999999", { from: CORE_MULTISIG })

    // We unlock
    await delta.activatePostFirstRebasingState({ from: DELTA_MULTI_SIG_ADDRESS });
    await routerUni.swapTokensForExactTokens(wholeUnits(10), wholeUnits(1), wethToDelta, ape1, "99999999999999999", { from: ape1 })
    // We buy for 100eth
    await routerUni.swapExactETHForTokens(wholeUnits(10000), wethToDelta, ape1, "99999999999999999", { from: ape1, value: wholeUnits(100) });
    await delta.approve(routerUni.address, wholeUnits(6966999999969), { from: ape1 })
    //selling 1 token
    await routerUni.swapExactTokensForTokens(wholeUnits(1), "0", deltaToWeth, ape1, "99999999999999999", { from: ape1 });
  })


  const getUserStats = async (user) => {
    const userInfoVault = await dfv.userInfo(user);
    const userInfoDelta = await delta.userInformation(user);

    return {
      ...userInfoVault,
      maxBalance: new BN(userInfoDelta.maxBalance),
      rlpBalance: await rlp.balanceOf(user),
      deltaBalance: await delta.balanceOf(user),
      totalFarmingPower: user == dfv.address ? (await dfv.vaultInfo()).totalFarmingPower : 0
    }
  }

  // TODO: TO be completed.
  // ✓ Withdrawl RLP via the withdrawal function
  // ✓ Best to make this into a check function like burnDEltadeposit
  // ✓ RLP withdrawal should properly affect the total farming power of user and vault
  // ✓ it should remove rlp that user has
  // ✓ It should send it to the user for the exact amount said
  // ✓ And remove it from the vault
  // User should have a compound made when he withdraws ( with the farming power BEFORE withdrawal )
  // REward debt should be updated correctlly
  // Since you should have deposit RLP test function already u can spam it from different wallets
  //  to see if you can catch edge cases
  const rlpDeposit = async (from, amount) => {
    const RLP_RATIO = await dfv.RLP_RATIO();

    amount = new BN(amount)
    await approve(from, rlp.address, dfv.address, amount);

    const beforeDepositor = await getUserStats(from);
    const beforeVault = await getUserStats(dfv.address);

    await dfv.deposit(amount, 0, { from });

    const afterDepositor = await getUserStats(from);
    const afterVault = await getUserStats(dfv.address);
    printStruct(afterVault)
    printStruct(beforeVault)

    assert(afterVault.totalFarmingPower.sub(beforeVault.totalFarmingPower).eq(amount.mul(RLP_RATIO)), "Total farming power of vault did not change properly")
    assert(afterVault.rlpBalance.sub(beforeVault.rlpBalance).eq(amount), "Vault got too much or to litttle");
    expect(beforeDepositor.rlpBalance.sub(afterDepositor.rlpBalance)).to.be.bignumber.equal(amount, "Vault got too much or to litttle");
    assert(beforeDepositor.maxBalance.sub(afterDepositor.maxBalance).eq(new BN('0')), "Depositor balances are wrong - removed too much or too little");

    // Normal rLP deposit should have no change in DELTA
    assert(beforeDepositor.deltaBalance.eq(afterDepositor.deltaBalance), "Shoudn't get DELTA");
    assert(beforeVault.deltaBalance.eq(afterVault.deltaBalance), "Shoudn't get DELTA");

    assert(afterDepositor.lastBooster == 1, "Booster is wrong");
    // Last boosterDEposit should not changed
    assert(afterDepositor.lastBoosterDepositTimestamp.eq(beforeDepositor.lastBoosterDepositTimestamp), "Booster timestamp changed");

    // Farming power, total delta, withdrawable all should change for exactly amount
    // Note this function doesnt test moving multiplier down because then farming power would change
    expect(afterDepositor.farmingPower.sub(beforeDepositor.farmingPower)).to.be.bignumber.equal(amount.mul(RLP_RATIO), "Farming power changed wrong");

    printStruct(beforeDepositor)
    printStruct(afterDepositor)
    assert(afterDepositor.deltaWithdrawable.sub(beforeDepositor.deltaWithdrawable).eq(new BN('0')), "Withdrawable changed wrong");
    expect(afterDepositor.rlp.sub(beforeDepositor.rlp)).to.be.bignumber.equal(amount, "Withdrawable changed wrong");
    assert(afterDepositor.totalDelta.sub(beforeDepositor.totalDelta).eq(new BN('0')), "totalDelta changed wrong");

    return { // for running additional checks
      beforeDepositor, beforeVault, afterDepositor, afterVault
    }
  };

  const withdrawRlp = async (from, amount) => {
    const RLP_RATIO = await dfv.RLP_RATIO();

    amount = new BN(amount)
    const beforeDepositor = await getUserStats(from);
    const beforeVault = await getUserStats(dfv.address);

    await dfv.withdrawRLP(amount, { from });

    const afterDepositor = await getUserStats(from);
    const afterVault = await getUserStats(dfv.address);
    printStruct(afterVault)
    printStruct(beforeVault)

    expect(beforeVault.totalFarmingPower.sub(afterVault.totalFarmingPower)).to.be.bignumber.equal(amount.mul(RLP_RATIO), "Total farming power of vault did not change properly");
    expect(beforeVault.rlpBalance.sub(afterVault.rlpBalance)).to.be.bignumber.equal(amount, "Vault removed too much or to litttle");
    expect(afterDepositor.rlpBalance.sub(beforeDepositor.rlpBalance)).to.be.bignumber.equal(amount, "Vault removed too much or to litttle");
    expect(afterDepositor.maxBalance.sub(beforeDepositor.maxBalance)).to.be.bignumber.equal('0', "Depositor balances are wrong - added too much or too little");

    // Normal rLP deposit should have no change in DELTA
    expect(beforeDepositor.deltaBalance).to.be.bignumber.equal(afterDepositor.deltaBalance, "Shoudn't withdraw DELTA");
    expect(beforeVault.deltaBalance).to.be.bignumber.equal(afterVault.deltaBalance, "Shoudn't withdraw DELTA");

    expect(afterDepositor.lastBooster).to.be.bignumber.equal('1', "Booster is wrong");
    // Last boosterDEposit should not changed
    expect(afterDepositor.lastBoosterDepositTimestamp).to.be.bignumber.equal(beforeDepositor.lastBoosterDepositTimestamp, "Booster timestamp changed");

    // Farming power, total delta, withdrawable all should change for exactly amount
    // Note this function doesnt test moving multiplier down because then farming power would change
    expect(beforeDepositor.farmingPower.sub(afterDepositor.farmingPower)).to.be.bignumber.equal(amount.mul(RLP_RATIO), "Farming power changed wrong");

    printStruct(beforeDepositor)
    printStruct(afterDepositor)
    expect(afterDepositor.deltaWithdrawable.sub(beforeDepositor.deltaWithdrawable)).to.be.bignumber.equal('0', "Withdrawable changed wrong");
    expect(beforeDepositor.rlp.sub(afterDepositor.rlp)).to.be.bignumber.equal(amount, "Withdrawable changed wrong");
    expect(afterDepositor.totalDelta.sub(beforeDepositor.totalDelta)).to.be.bignumber.equal('0', "totalDelta changed wrong");

    return { // for running additional checks
      beforeDepositor, beforeVault, afterDepositor, afterVault
    }
  };

  const normalDELTADeposit = async (from, amount) => {
    amount = new BN(amount)
    await delta.approve(dfv.address, wholeUnits(6966999999969), { from })
    const beforeDepositor = await getUserStats(from);
    const beforeVault = await getUserStats(dfv.address);

    await dfv.deposit(0, amount, { from });

    const afterDepositor = await getUserStats(from);
    const afterVault = await getUserStats(dfv.address);
    printStruct(afterVault)
    printStruct(beforeVault)

    await assert(afterVault.totalFarmingPower.sub(beforeVault.totalFarmingPower).eq(amount), "Total farming power of vault did not change properly")

    await assert(afterVault.deltaBalance.sub(beforeVault.deltaBalance).eq(amount), "Vault got too much or to litttle");
    await assert(beforeDepositor.maxBalance.sub(afterDepositor.maxBalance).eq(amount), "Depositor balances are wrong - removed too much or too little");

    // Normal delta deposit should have no change in rlp
    await assert(beforeDepositor.rlp.eq(afterDepositor.rlp), "Shoudn't get RLP");
    await assert(beforeVault.rlpBalance.eq(afterVault.rlpBalance), "Shoudn't get RLP");

    // Delta when you deposit normally should force multiplier to be 1
    await assert(afterDepositor.lastBooster == 1, "Booster is wrong");
    // Last boosterDEposit should not changed
    await assert(afterDepositor.lastBoosterDepositTimestamp.eq(beforeDepositor.lastBoosterDepositTimestamp), "Booster timestamp changed");

    // Farming power, total delta, withdrawable all should change for exactly amount
    // Note this function doesnt test moving multiplier down because then farming power would change
    await assert(afterDepositor.farmingPower.sub(beforeDepositor.farmingPower).eq(amount), "Farming power changed wrong");

    printStruct(beforeDepositor)
    printStruct(afterDepositor)
    await assert(afterDepositor.deltaWithdrawable.sub(beforeDepositor.deltaWithdrawable).eq(amount), "Withdrawable changed wrong");


    await assert(afterDepositor.totalDelta.sub(beforeDepositor.totalDelta).eq(amount), "totalDelta changed wrong");


    return { // for running additional checks
      beforeDepositor, beforeVault, afterDepositor, afterVault
    }
  }


  const burnDELTADeposit = async (from, amount) => {
    amount = new BN(amount)
    await delta.approve(dfv.address, wholeUnits(6966999999969), { from });
    const beforeBurn = await getUserStats(BURN);
    const beforeDepositor = await getUserStats(from);
    const beforeVault = await getUserStats(dfv.address);
    await dfv.depositWithBurn(amount, { from });
    const afterDepositor = await getUserStats(from);
    const afterVault = await getUserStats(dfv.address);
    const afterBurn = await getUserStats(BURN);
    const halfOfTheAmount = amount.div(new BN(2));

    await assert(afterBurn.deltaBalance.sub(beforeBurn.deltaBalance).eq(halfOfTheAmount), "Burn address didn't get");
    await assert(beforeDepositor.maxBalance.sub(afterDepositor.maxBalance).eq(amount), "Depositor balances are wrong - removed too much or too little");

    // delta deposit should have no change in rlp
    await assert(beforeDepositor.rlp.eq(afterDepositor.rlp), "Shoudn't get RLP");
    await assert(beforeVault.rlpBalance.eq(afterVault.rlpBalance), "Shoudn't get RLP");

    const lastBoost = afterDepositor.lastBooster;
    // Delta when you deposit normally should force multiplier to be 1
    await assert(lastBoost.gt(1), "Booster is wrong");

    const changeInBooster = lastBoost.sub(beforeDepositor.lastBooster);
    const assumedFarmingPowerChange = amount.mul(lastBoost).add(changeInBooster.mul(beforeDepositor.totalDelta));

    verbose && (
      console.log(`Boost before ${beforeDepositor.lastBooster}, boost after ${lastBoost}`),
      console.log(`User farming power before ${beforeDepositor.farmingPower}, after ${afterDepositor.farmingPower}`),
      console.log(`Vault farming power ${beforeVault.totalFarmingPower}, after ${afterVault.totalFarmingPower}`),
      console.log(`Assumed farming power change ${assumedFarmingPowerChange}`)

    )

    await assert(afterVault.totalFarmingPower.sub(beforeVault.totalFarmingPower).eq(assumedFarmingPowerChange), "Total farming power of vault did not change properly")

    // Farming power, total delta, withdrawable all should change for exactly amount
    // Note this function doesnt test moving multiplier down because then farming power would change
    await assert(afterDepositor.deltaWithdrawable.sub(beforeDepositor.deltaWithdrawable).eq(halfOfTheAmount), "Farming power changed wrong");
    await assert(afterDepositor.deltaPermanent.sub(beforeDepositor.deltaPermanent).eq(halfOfTheAmount), "Farming power changed wrong");
    await assert(afterDepositor.deltaVesting.sub(beforeDepositor.deltaVesting).gte(new BN(0)), "Lost vesting");
    await assert(afterDepositor.totalDelta.sub(beforeDepositor.totalDelta).eq(amount), "totalDelta changed wrong");
    await assert(afterDepositor.farmingPower.sub(beforeDepositor.farmingPower).eq(assumedFarmingPowerChange), "Wrong calculation for farming power");

    return { // for running additional checks
      beforeDepositor, beforeVault, afterDepositor, afterVault
    }
  }



  xit('Handles normal deposits', async () => {

    await buyDELTA(wholeUnits(100), ape1);
    // Deposit 1 token normally
    await normalDELTADeposit(ape1, wholeUnits(1));
    await normalDELTADeposit(ape1, wholeUnits(69));
    await normalDELTADeposit(ape1, wholeUnits(1000));

    await buyDELTA(wholeUnits(100), ape2);
    await normalDELTADeposit(ape2, wholeUnits(1000));
    await normalDELTADeposit(ape1, wholeUnits(1));

  });


  xit('Handles burn deposits, correctly assigns 10 on first deposit', async () => {
    await buyDELTA(wholeUnits(100), ape1);
    await buyDELTA(wholeUnits(100), ape2);
    // Deposit 1 token normally
    let { afterDepositor } = await burnDELTADeposit(ape1, wholeUnits(1));
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");

    await burnDELTADeposit(ape1, wholeUnits(1));

    let { afterDepositor: afterDepositor2 } = await burnDELTADeposit(ape2, wholeUnits(6));
    await assert(afterDepositor2.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await burnDELTADeposit(ape1, wholeUnits(12));

  });


  const testsForBooster = async (person) => {
    await buyDELTA(wholeUnits(100), person);
    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //1
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //2
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //3
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //4
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //5
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //6
     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(24); //7

    let info = await dfv.realFarmedOfPerson(person)
    verbose && console.table(info)
    await assert(info.booster == "7", "Didnt properly adjust booster");

     ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(10)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
      await advanceByHours(24); //8
    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(10)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");

    await advanceByHours(dayInHours * 5); 
    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(10)))
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(dayInHours * 2); 

    info = await dfv.realFarmedOfPerson(person)
    verbose && console.table(info)
    await assert(info.booster == "7", "Didnt properly adjust booster");
    await advanceByHours(dayInHours * 7); 

    info = await dfv.realFarmedOfPerson(person)
    verbose && console.table(info)
    await assert(info.booster == "4", "Didnt properly adjust booster");

    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(10)))
    await assert(afterDepositor.lastBooster.toString() == "5", "Didnt properly adjust booster");
     await advanceByHours(dayInHours * 7); 
    info = await dfv.realFarmedOfPerson(person)
    verbose && console.table(info)
    await assert(info.booster == "2", "Didnt properly adjust booster");
     await advanceByHours(dayInHours * 7); 
    info = await dfv.realFarmedOfPerson(person)
    verbose && console.table(info)
    await assert(info.booster == "1", "Didnt properly adjust booster");
    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(10)))
    await assert(afterDepositor.lastBooster.toString() == "2", "Didnt properly adjust booster");
     await advanceByHours(dayInHours * 7); 
    info = await dfv.realFarmedOfPerson(person);

    verbose && console.table(info);
    ({afterDepositor} = await burnDELTADeposit(person, wholeUnits(1))) // should nto be enough
    await assert(afterDepositor.lastBooster.toString() == "1", "Didnt properly adjust booster");
  }

  xit("correctly adjusts lastBooster after burn", async () => {
    await buyDELTA(wholeUnits(100), ape1);
    let { afterDepositor } = await burnDELTADeposit(ape1, wholeUnits(1));
    await assert(afterDepositor.lastBooster.toString() == "10", "First burn deposit should give 10x booster");
    await advanceByHours(9999999999);
    ({ afterDepositor } = await burnDELTADeposit(ape1, "0"));
    await assert(afterDepositor.lastBooster.toString() == "1", "Did not adjust");

    // we test normally
    await testsForBooster(ape2);
    // We test with compound turned on
    await dfv.setCompundBurn(true, {from : ape3})
    await testsForBooster(ape3);
  });

  xit("Correctly assigns farmed with one person", async () => {
    await buyDELTA(wholeUnits(100), ape1);
    //Ape2 provides rewards
    await buyDELTA(wholeUnits(100), ape2);

    await burnDELTADeposit(ape1, wholeUnits(1));
    await weth.approve(dfv.address, wholeUnits(1000), {from : ape2} )
    await delta.approve(dfv.address, wholeUnits(1000), {from : ape2} )
    await weth.deposit({value : wholeUnits(100), from : ape2})


    // 100 delta and 10 weth
    await dfv.addNewRewards(wholeUnits(1000), wholeUnits(1), {from: ape2});
    await dfv.deposit(0,0, { from : ape3});

    let info = await dfv.realFarmedOfPerson(ape1);
    verbose && printStruct(info);

    await assert(new BN(info.farmedETH).eq(wholeUnits(1)),"Did not farm everything in the vault")
    await assert(new BN(info.farmedDelta).eq(wholeUnits(1000)),"Did not farm everything in the vault")
    await assert(new BN(info.recycledDelta).eq(new BN(0)),"HAve recycled")
    await assert(new BN(info.recycledETH).eq(new BN(0)),"HAve recycled")

    await advanceByHours(dayInHours * 50); 
    info = await dfv.realFarmedOfPerson(ape1);
    verbose && printStruct(info);
    await advanceByHours(dayInHours * 50); 
    info = await dfv.realFarmedOfPerson(ape1);
    verbose && printStruct(info);
  });


  xit("It correctly deposits RLP", async () => {
    await mintRLP(ape1,wholeUnits(100));
    const ape1RLP = await rlp.balanceOf(ape1);
    //deposit rlp
    await buyDELTA(wholeUnits(100), ape1);
    await normalDELTADeposit(ape1, wholeUnits(1));
    await rlpOnlyDeposit(ape1, ape1RLP);
  });

  const printAllTransactionBuckets = async (person)=> {
    let buckets = {};
    for(var i=0;i<7;i++) {
        const transaction = await delta.vestingTransactions(person, i);
        const transactionDetails = await delta.getTransactionDetail([transaction.amount.toString(), transaction.fullVestingTimestamp.toString()]);
        buckets[i] = {mature : transactionDetails.mature, immature:transactionDetails.immature, amount:transactionDetails.amount, fullVestingTimestamp:transactionDetails.fullVestingTimestamp };
      } 
      console.table(buckets);
  }


 xit("It should be able to burn without ever putting DELTA in aka a compound burn", async () => {
    // Deposit RLP via a the deposit function
    await mintRLP(ape1, wholeUnits(100));
    const ape1RLP = await rlp.balanceOf(ape1);
    //deposit rlp
    await rlpOnlyDeposit(ape1, ape1RLP);
    // Add some amounts to the vault
    // Have a user burn some tokens

    const deltaBought = await swapEthForDelta(ape2, wholeUnits(1), weth, delta, deltaWethPair, routerUni, { from: ape2 });
    const approximateAmountOfDeltaBurned = (deltaBought.mul(new BN(10))).sub(deltaBought);
    const PERCENT_DEEP_FARMING_VAULT = await distributor.PERCENT_DEEP_FARMING_VAULT();
    const expectedAmountOfDeltaSentToFarm = approximateAmountOfDeltaBurned.mul(PERCENT_DEEP_FARMING_VAULT).div(new BN(100));
    const ethGotAfterInstasell = await swapDeltaForEth(ape2, weth, deltaBought, delta, deltaWethPair, routerUni);
    await distributor.distribute({ from: ape1 });
    const burnedDeltaBeforeDistribute = await delta.balanceOf(BURN);
    aroundIsh(expectedAmountOfDeltaSentToFarm, (await delta.balanceOf(dfv.address)), "DFV didn't get the right quantity of coins from forfeiting", 4);

    const preCompoundFarmingPower = (await dfv.userInfo(ape1)).farmingPower;
    // Check that the user got everything in his farmed
    // Do a compund burn by setting the compund burn variable
    await dfv.setCompundBurn(true, { from: ape1 });

    // And then updating with depositing 0 or using compound function
    await dfv.deposit(0, 0, { from: ape1 });
    // User should now have 10x booster because he had 0 totalDelta before so any delta with compound should work
    const userInfo = await dfv.userInfo(ape1);
    assert(userInfo.lastBooster.eq(new BN(10)), "Expected booster of 10x after compounding for the first time");

    // The user now should have half of the farmed in vesting
    const uInfo = await dfv.userInfo(ape1);
    // Half of the farmed in burned
    const burnedDelta = (await delta.balanceOf(BURN)).sub(burnedDeltaBeforeDistribute);
    // assert(burnedDelta.eq())
    aroundIsh(burnedDelta, (expectedAmountOfDeltaSentToFarm.div(new BN(2))), "didnt burn half the farmed coins", 4);
    // And totalDelta equal to farmed
    assert(uInfo.deltaPermanent.eq( uInfo.deltaVesting ), "Expected vesting to equal permanent after a single compound");
    aroundIsh(uInfo.deltaPermanent, expectedAmountOfDeltaSentToFarm.div(new BN(2)), "e20", 4);
    // And farming power added equal to farmed * booster
    const addedFarmingPower = uInfo.farmingPower.sub(preCompoundFarmingPower);
    assert(addedFarmingPower.eq(uInfo.deltaPermanent.mul(new BN(20))), "farming power added equal to farmed * booster");
    // Add some amounts again and try to compound burn again to see that it fails thanks to the check
    const deltaBoughtRound2 = await swapEthForDelta(ape2, wholeUnits(10), weth, delta, deltaWethPair, routerUni, { from: ape2 });
    // const approximateAmountOfDeltaBurnedRound2 = (deltaBoughtRound2.mul(new BN(10))).sub(deltaBoughtRound2);
    const ethGotAfterInstasellRound2 = await swapDeltaForEth(ape2, weth, deltaBoughtRound2, delta, deltaWethPair, routerUni);
    await distributor.distribute({ from: ape1 });
    
    await expectRevert(dfv.deposit(0, 0, { from: ape1 }), "Cannot use compounding burn without getting boost up, uncheck compounding burn, or wait 14 days")
    // Then wait a week until brown period and compound burn should now work
    await advanceTimeAndBlock(604800 + 600); // a week plus an hour
    const laterUInfo = await dfv.userInfo(ape1);
    printStruct(laterUInfo);
    assert(laterUInfo.lastBooster.eq(new BN('10')), "booster should still be 10 during brown period");
    await dfv.deposit(0, 0, { from: ape1 }); // This just shouldn't fail now
    // TODO: Reward debt should be updated correctly
    // TODO: Recycling should be done correctly, can add a hook to the test functions to return recycled amount

  });

  it("It should be able to withdraw RLP", async () => {
    const rlpAmount = await mintRLP(ape2, wholeUnits(5));
    const dRes = await rlpDeposit(ape2, rlpAmount);
    const wRes = await withdrawRlp(ape2, rlpAmount);
    expect(wRes.afterVault.rlpBalance).to.be.bignumber.equal(dRes.beforeVault.rlpBalance);
    expect(dRes.beforeDepositor.rlpBalance).to.be.bignumber.equal(wRes.afterDepositor.rlpBalance);
  });

  // Buys 1 ETH worth of coins and then sells them all back immediately.
  // Produces farming rewards for other wallets.
  async function makeWalletForfeitCoins(account, distribute = true, eth = 1) {
    
    const distributoreDeltaBalanceBefore = await delta.balanceOf(distributor.address);
    const dfvDeltaBalanceBefore = await delta.balanceOf(dfv.address);
    const deltaInPairBeforePurchase = await delta.balanceOf(deltaWethPair.address);
    const maturedDeltaBought = await swapEthForDelta(account, wholeUnits(1), weth, delta, deltaWethPair, routerUni, { from: account });
    const deltaInPairAfterPurchase = await delta.balanceOf(deltaWethPair.address);
    const fullDeltaBought = deltaInPairBeforePurchase.sub(deltaInPairAfterPurchase);
    console.log(`Bought ${fullDeltaBought/1e18} DELTA (${fullDeltaBought/1e18*0.1})`);
    

    const PERCENT_DEEP_FARMING_VAULT = await distributor.PERCENT_DEEP_FARMING_VAULT();
    
    const sellerBalance = await delta.balanceOf(account);
    console.log(`sellerBalance: ${sellerBalance} ${sellerBalance/1e18}`);
    const ethFromSelling = await swapDeltaForEth(account, weth, sellerBalance, delta, deltaWethPair, routerUni);
    const fullDeltaSoldBack = (await delta.balanceOf(deltaWethPair.address)).sub(deltaInPairAfterPurchase)
    console.log(`fullDeltaSoldBack: ${fullDeltaSoldBack} ${fullDeltaSoldBack/1e18}`);
    if(distribute) {
      const distributoreDeltaBalanceAfterSend = await delta.balanceOf(distributor.address);
      await distributor.distribute({ from: account });
      const dfvDeltaBalanceAfter = await delta.balanceOf(dfv.address);
      // console.log(await getLatestTimestamp(web3))

      const deltaBurnedExpected = fullDeltaBought.mul(new BN(8999)).div(new BN(10000)); // 90% is burned
      const deltaBurned = distributoreDeltaBalanceAfterSend.sub(distributoreDeltaBalanceBefore);
      console.log(`
        deltaInPairBeforePurchase: ${deltaInPairBeforePurchase/1e18}
        deltaInPairAfterPurchase: ${deltaInPairAfterPurchase/1e18}
        fullDeltaBought: ${fullDeltaBought/1e18}
        deltaBurnedExpected: ${deltaBurnedExpected/1e18}
        deltaBurned: ${deltaBurned/1e18}
      `);
      aroundIsh(deltaBurned, deltaBurnedExpected, "Expected to burn 90% of immature coins");
      const expectedAmountOfDeltaSentToFarm = (deltaBurned.mul(PERCENT_DEEP_FARMING_VAULT)).div(new BN(100));
      await aroundIsh(
        dfvDeltaBalanceAfter,
        dfvDeltaBalanceBefore.add(expectedAmountOfDeltaSentToFarm),
        "DFV credit from vesting interruption expected"
      )
    }
    return {
      maturedDeltaBought,
      fullDeltaBought,
      ethFromSelling
    }
  }

  it("It correctly update reward debt", async () => {
    expect((await dfv.userInfo(ape1)).rewardDebtETH).to.be.bignumber.equal("0");
    expect((await dfv.userInfo(ape1)).rewardDebtDELTA).to.be.bignumber.equal("0");
    const rlpAmount = await mintRLP(ape2, wholeUnits(5));
    const dRes = await rlpDeposit(ape2, rlpAmount);
    console.log(
      (await dfv.userInfo(ape1)).rewardDebtETH.toString()
    );
    console.log(
      (await dfv.userInfo(ape1)).rewardDebtDELTA.toString()
    );
    await makeWalletForfeitCoins(ape2);
    console.log(
      (await dfv.userInfo(ape1)).rewardDebtETH.toString()
    );
    console.log(
      (await dfv.userInfo(ape1)).rewardDebtDELTA.toString()
    );

    // mutates rewardDebtETH
    // exit()
    // This happens when they have a permanent balance, otherwise it is unchanged
    // addPermanentCredits
    // _deposit
    // withdrawrLP

    // Check functions already return reward debt
    // So you can add pending, then claim and check the reward debt from their returns quite easily.
    // This should be checked for functions : exit(), withdrawRLP(), deposit(), depositFor() [from another wallet]
  });

  it("Test guardian role functionality", async () => {
    expect(await dfv.isAGuardian(ape1)).to.be.false;

    // delta multisig is not a guardian but the governance
    expect(await dfv.isAGuardian(DELTA_MULTI_SIG_ADDRESS)).to.be.false;

    // only multisig can edit guardians
    await expectRevert(dfv.editGuardianRole(ape1, true), "!governance");

    // ape1 is not a guardian, should revert
    await expectRevert(dfv.emergencyShutdown({from: ape1 }), "!guardian");
    
    const snapshot = await takeSnapshot();

    // add ape1 to guardian list
    await dfv.editGuardianRole(ape1, true, { from: DELTA_MULTI_SIG_ADDRESS });

    // only multisign is allow to revert the emergency shutdown
    // should not revert now as ape1 is guardian
    await expectRevert(dfv.emergencyShutdown(true, {from: ape1 }), "!governance");
    await revertToSnapshot(snapshot);

    // Should not revert when reverting the emergencyMode when called by multisig
    await dfv.emergencyShutdown(true, {from: DELTA_MULTI_SIG_ADDRESS });
    await revertToSnapshot(snapshot);

    // add ape1 to guardian list
    await dfv.editGuardianRole(ape1, true, { from: DELTA_MULTI_SIG_ADDRESS });
    await dfv.emergencyShutdown(false, {from: ape1 });
    await dfv.editGuardianRole(ape1, false, { from: DELTA_MULTI_SIG_ADDRESS });
    await expectRevert(dfv.emergencyShutdown({from: ape1 }), "!guardian");

    // Make sure panic mode STOPS all functions from rowking
    await revertToSnapshot(snapshot);

    // transfer some unmature delta to have something in  distributor pendingCredits
    // and can call claimCredits to call dfv's addPermanentCredits and test
    // if it's not callable in emergency mode.
    await expectRevert(distributor.claimCredit({ from: ape1 }), 'Nothing to claim');
    expect(await distributor.pendingCredits(ape1)).to.be.bignumber.equal("0");
    await delta.activatePostFirstRebasingState({ from: DELTA_MULTI_SIG_ADDRESS });
    await delta.transfer(ape2, timesDecimals(100), { from: DELTA_MULTI_SIG_ADDRESS });
    await delta.transfer(ape1, timesDecimals(100), { from: ape2 });
    await delta.transfer(ape3, timesDecimals(10), { from: ape1 });
    expect(await distributor.pendingCredits(ape1)).to.be.bignumber.gt("0");

    await dfv.emergencyShutdown(false, { from: DELTA_MULTI_SIG_ADDRESS });
    await expectRevert(distributor.claimCredit({ from: ape1 }), "Emergency mode is active, all actions are paused");
    await expectRevert(dfv.compound(ape1), "Emergency mode is active, all actions are paused");
    await expectRevert(dfv.exit(), "Emergency mode is active, all actions are paused");
    await expectRevert(dfv.withdrawRLP(123), "Emergency mode is active, all actions are paused");
    await expectRevert(dfv.setCompundBurn(false), "Emergency mode is active, all actions are paused");

    // use editGuardianRole and check if that user can now panic and if other users cannot panic
    await revertToSnapshot(snapshot);
    await dfv.editGuardianRole(ape1, true, { from: DELTA_MULTI_SIG_ADDRESS });
    await expectRevert(dfv.emergencyShutdown(false, {from: ape2 }), "!guardian");
    await dfv.emergencyShutdown(false, {from: ape1 });
  });

  it("test only One per block", async () => {
    // Check the onlyOnePerBlock function
    // USing new hardhat functionality this should be possible
    // HAving 2 transactions (ANY) in one block for one wallet should be disallowed (for one wallet not from one wallet)
  });

  xit("Test proper funcionality of the withdrawal contract", async () => {

    await buyDELTA(wholeUnits(100), ape1);
    // withdrawable
    console.log("Doing a normal deposit");
    await normalDELTADeposit(ape1, wholeUnits(2));
    // permanent
    console.log("Doing a burn deposit");
    await burnDELTADeposit(ape1, wholeUnits(6)); // has to eb 2x first
    await exitFunctionTest(ape1, wholeUnits(2), wholeUnits(6), new BN(0));; //Test with burning and normal deposit but without rlp

    const withdrawalContractAddress = await dfv.withdrawalContracts(ape1, 0);
    console.log("withdrawalContractAddress",withdrawalContractAddress)
    const withdrawalContract = await WithdrawalContract.at(withdrawalContractAddress);

    const principleInContract = await withdrawalContract.PRINCIPLE_DELTA();
    const vestingInContract = await withdrawalContract.VESTING_DELTA();
    const balanceOfContract = await delta.balanceOf(withdrawalContract.address)
    printStruct({vestingInContract, principleInContract})
    await assert ( principleInContract.eq(wholeUnits(5))) // 6 /2 + 2
    await assert ( principleInContract.add(vestingInContract).eq(balanceOfContract), "Wrong principle and vesting") // 6 /2 + 2
    await expectRevert ( withdrawalContract.withdrawEverythingWithdrawable({from : ape1}), "You need to wait 14 days to withdraw principle");
    await expectRevert ( withdrawalContract.withdrawEverythingWithdrawable({from : ape2}), "You are not the owner of this withdrawal contract");
    await expectRevert ( withdrawalContract.withdrawPrinciple({from : ape1}), "You need to wait 14 days to withdraw principle");
    await assert ( (await withdrawalContract.percentMatured()).eq(new BN(5)), "5% should be mature");

    console.log("Advancing 7 days")
    await advanceByHours(24 * 7);
    console.log(`Percent matured${(await withdrawalContract.percentMatured()).toString()}`)
    console.log("Advancing 7 days")
    await advanceByHours(24 * 7);
    console.log(`Percent matured${(await withdrawalContract.percentMatured()).toString()}`)
    console.log("withdrawing principle")
        await assert ( principleInContract.add(vestingInContract).eq(balanceOfContract), "Wrong principle and vesting") // 6 /2 + 2

    await withdrawalContract.withdrawPrinciple({from : ape1});
    const balanceOfContractAfterWithdrawal = await delta.balanceOf(withdrawalContract.address)
    await assert ( vestingInContract.eq(balanceOfContractAfterWithdrawal), "Wrong principle and vesting") 

    console.log(`Percent matured${(await withdrawalContract.percentMatured()).toString()}`)
    await advanceByHours(24 * 365);
      console.log(`Percent matured${(await withdrawalContract.percentMatured()).toString()}`)

    await assert((await withdrawalContract.percentMatured()).eq(new BN(100)))

    await withdrawalContract.withdrawEverythingWithdrawable();
    const balanceOfContractAfterWithdrawal2 = await delta.balanceOf(withdrawalContract.address)
    await assert ( ZERO.eq(balanceOfContractAfterWithdrawal2), "Wrong principle and vesting") 

  });

  it("Test the addPermanentCredits() function", async () => {
    // This function is a special one
    // That can only ber called from the distributor
    // IF the user has credit inside the distributor
    // Then the user can call the credit function
    // IT should zero out his credit in distributor
    // It should claim/compound
    // It should then add the credit into permanent balance inside the DFV
    // And adjust all the debts correct
    // And adjust allt eh farming power correctly for vault and user 
    // As well as the totalDelta of user
  });

  it("Test the accuracy of recycling logic", async () => {
    // Recycling logic is not that accurate but it should be reasonably accurate
    // To push recycling logic to all u have to have rlp farming power
    // Because it decides totals from delta not from rlp
    // Thjis means it should only recycle the amount you make from delta and in the right percentages
    // REcycling should send to msg.sender 1% of the recycled amount of WETH and DELTA

  });


  it("Correctly distributes farmed amoungst n people with rlp delta boosters etc", async () => {
    // self evident by the title
    // Have a ton of people farming with different boosters, compound schedules
    // And check they all get farmed as they should
  });




  // We conduct a exit() function call and test all all logical assertions for the state of vault before and user before and .. after
  const exitFunctionTest = async (fromAccount, normalDeposited, burnDeposited, rlpDeposited) => {

    // We add rewards
    await weth.approve(dfv.address, wholeUnits(1000), {from : ape2} );
    await delta.approve(dfv.address, wholeUnits(1000), {from : ape2} );
    await weth.deposit({value : wholeUnits(100), from : ape2});
    const rewardsETH = wholeUnits(100);
    const rewardsDELTA = wholeUnits(1000);
    await buyDELTA(wholeUnits(100), ape2);

    await dfv.addNewRewards(rewardsDELTA, rewardsETH, {from: ape2});

    const RLP_RATIO = new BN(await dfv.RLP_RATIO());
    const farmingPowerFromRLP = rlpDeposited.mul(RLP_RATIO);
    const vestingDelta = rewardsDELTA;
    const permanentDelta  = burnDeposited.div( new BN(2));
    const withdrawableDelta = normalDeposited.add( permanentDelta ); // permanent and withdrawable is 50/50
    const totalAddedDelta = vestingDelta.add(permanentDelta).add(withdrawableDelta);
    const totalFarmingPower = totalAddedDelta.mul(new BN(10)).add(farmingPowerFromRLP) // 10x booster


    // update vault so we have farmed
    await dfv.deposit(0,0, { from : ape3});

    const vaultInfo = await dfv.vaultInfo();
    const accumulatedPerShareETH = new BN(vaultInfo.accumulatedETHPerShareE12);
    const accumulatedDELTAPerShareE12 = new BN(vaultInfo.accumulatedDELTAPerShareE12);

    const calculatedETHDebt = totalFarmingPower.mul(accumulatedPerShareETH);
    const calculatedDELTADebt = totalFarmingPower.mul(accumulatedDELTAPerShareE12);

    let info = await dfv.realFarmedOfPerson(fromAccount);
    console.table(info)

    console.log(rewardsETH.toString())
    console.log(rewardsDELTA.toString())

    await aroundIsh(info.farmedETH, rewardsETH, "Did not farm everything in the vault"); // Ther eis a possible loss
    await aroundIsh(info.farmedDelta, rewardsDELTA, "Did not farm everything in the vault"); // there is a possible loss from inprecision

    // We shoudnt recycle
    await assert(new BN(info.recycledDelta).eq(new BN(0)),"HAve recycled");
    await assert(new BN(info.recycledETH).eq(new BN(0)),"HAve recycled");

    
    await assert((await dfv.userInfo(fromAccount)).rewardDebtETH.eq(ZERO), 'wrong reward debt');
    await assert((await dfv.userInfo(fromAccount)).rewardDebtDELTA.eq(ZERO), 'wrong reward debt');

    // We claim.
    await dfv.setCompundBurn(false, {from : fromAccount})
    await dfv.deposit(0,0, { from : fromAccount});

    printStruct({calculatedETHDebt, calculatedDELTADebt, rewardDebtETH : (await dfv.userInfo(fromAccount)).rewardDebtETH, rewardDebtDELTA: (await dfv.userInfo(fromAccount)).rewardDebtDELTA })

    await aroundIsh((await dfv.userInfo(fromAccount)).rewardDebtETH, calculatedETHDebt, 'wrong reward debt after claiming');
    await aroundIsh((await dfv.userInfo(fromAccount)).rewardDebtDELTA, calculatedDELTADebt, 'wrong reward debt after claiming');
      
    await aroundIsh((await dfv.vaultInfo()).totalFarmingPower, totalFarmingPower, 'vault wrong total farming power');
    await aroundIsh((await dfv.userInfo(fromAccount)).totalDelta, totalAddedDelta, 'taotal added delta wrong');
    await aroundIsh((await dfv.userInfo(fromAccount)).farmingPower, totalFarmingPower, 'user wrong total farming power');
    await aroundIsh((await dfv.userInfo(fromAccount)).deltaVesting, vestingDelta, 'user wrong vesting');
    await assert((await dfv.userInfo(fromAccount)).rlp.eq(rlpDeposited), 'wrong reward debt');
    await assert ( new BN((await dfv.userInfo(fromAccount)).deltaWithdrawable).eq(withdrawableDelta), 'wrong withdrawable');
    await assert ( new BN((await dfv.userInfo(fromAccount)).deltaPermanent).eq(permanentDelta), 'wrong permanent');

    ////
    // exit
    ///
    await dfv.exit({from:fromAccount});

    info = await dfv.userInfo(fromAccount);
    await assert(new BN(info.deltaVesting).eq(ZERO))
    await assert(new BN(info.deltaWithdrawable).eq(ZERO))
    await assert(new BN(info.rlp).eq(ZERO))
    await assert(new BN(info.deltaPermanent).eq(permanentDelta))
    await assert(new BN(info.farmingPower).eq(permanentDelta)) // 1 multiplier
    await assert(new BN(info.lastBooster).eq(ZERO)) // We deleted it
    await assert(new BN(info.totalDelta).eq(permanentDelta))


    await aroundIsh((await dfv.userInfo(fromAccount)).rewardDebtETH, permanentDelta.mul(accumulatedPerShareETH), 'wrong reward debt');
    await aroundIsh((await dfv.userInfo(fromAccount)).rewardDebtDELTA, permanentDelta.mul(accumulatedDELTAPerShareE12), 'wrong reward debt');

    const withdrawalContract = await dfv.withdrawalContracts(fromAccount,0);
    await aroundIsh((await delta.balanceOf(withdrawalContract)), vestingDelta.add(withdrawableDelta), 'withdrawl contract didnt get enough delta');
    await aroundIsh((await delta.balanceOf(withdrawalContract)), vestingDelta.add(withdrawableDelta), 'withdrawl contract didnt get enough delta');
    await aroundIsh((await weth.balanceOf(withdrawalContract)), ZERO, 'withdrawl shouldnt have eth');
    await aroundIsh((await delta.balanceOf(BURN)), permanentDelta, 'DFV doesnt have correc tnumet or delta left')
  }

  const ZERO = new BN(0);

  xit("Test the exit function", async () => {
    // Add delta
    await buyDELTA(wholeUnits(100), ape1);
    // withdrawable
    console.log("Doing a normal deposit");
    await normalDELTADeposit(ape1, wholeUnits(1));
    // permanent
    console.log("Doing a burn deposit");
    await burnDELTADeposit(ape1, wholeUnits(2)); // has to eb 2x first
    await exitFunctionTest(ape1, wholeUnits(1), wholeUnits(2), new BN(0));; //Test with burning and normal deposit but without rlp

    // We reset the state
    await reset();
    // We buy some RLP
    await mintRLP(ape1,wholeUnits(100));
    const ape1RLP = await rlp.balanceOf(ape1);
    //deposit rlp
    await buyDELTA(wholeUnits(100), ape1);
    await normalDELTADeposit(ape1, wholeUnits(1));
    await rlpOnlyDeposit(ape1,ape1RLP);
    await burnDELTADeposit(ape1, wholeUnits(2)); // has to eb 2x first

    await exitFunctionTest(ape1, wholeUnits(1), wholeUnits(2), ape1RLP); //Test with burning and normal deposit but without rlp

  });

  // Does a only rlp deposit into the vault and conducts all logical ssertions to it
  const rlpOnlyDeposit = async (ofWho, amountRLP) => {
    amountRLP = new BN(amountRLP);
    // aprove spend for vauilt
    await rlp.approve(dfv.address, amountRLP, {from : ofWho});
    await assert((await rlp.balanceOf(ofWho)).gte(amountRLP), "user does nto have enough rlp to deposit");

    const beforeDepositor = await getUserStats(ofWho);
    const beforeVault = await getUserStats(dfv.address);
    await dfv.deposit(amountRLP, "0", { from : ofWho });
    const afterDepositor = await getUserStats(ofWho);
    const afterVault = await getUserStats(dfv.address);

    let info = await dfv.userInfo(ofWho);
    await assert(new BN(info.recycledDelta).eq(new BN(0)),"HAve recycled")
    await assert(new BN(info.recycledETH).eq(new BN(0)),"HAve recycled")

    // Check that transfer was made correctly
    await assert(beforeDepositor.rlpBalance.sub(afterDepositor.rlpBalance).eq(amountRLP));
    await assert(afterVault.rlpBalance.sub(beforeVault.rlpBalance).eq(amountRLP));
    // balance in vault
    await assert(afterDepositor.rlp.sub(beforeDepositor.rlp).eq(amountRLP));

    const farmingPowerFromRLP = new BN(await dfv.RLP_RATIO());
    //Check that farming power was calculated ana ssigned correct
    await assert(afterVault.totalFarmingPower.sub(beforeVault.totalFarmingPower).eq(amountRLP.mul(farmingPowerFromRLP)));
    await assert(afterDepositor.farmingPower.sub(beforeDepositor.farmingPower).eq(amountRLP.mul(farmingPowerFromRLP)));
    await assert(afterDepositor.deltaWithdrawable.sub(beforeDepositor.deltaWithdrawable).eq(ZERO)); // withdrawable delta should nto change
    await assert(afterDepositor.lastBoosterDepositTimestamp.sub(beforeDepositor.lastBoosterDepositTimestamp).eq(ZERO)); // withdrawable delta should nto change

  }


  const mintRLP = async (forWho, amountETHUnits) => {
    try {
      await delta.activatePostFirstRebasingState({ from: DELTA_MULTI_SIG_ADDRESS });
    } catch {
      console.log("Already in post rebasing state");
    }

    return mintRlpWithEth(forWho, amountETHUnits, getConfig, false, 50);

  }


  const dayInHours = 24;

  const printStruct = (struct) => {

    const toPrint = {};

    Object.keys(struct).forEach(key => {
      if (isNaN(key)) { // labeled firleds gets rid of [0][1] etc returns usedForstruct
        toPrint[key] = struct[key].toString()
      }
    });

    verbose && console.table(toPrint)

  }


});




const second = 1;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;
const month = 4 * week;
const year = 12 * week;
const wholeUnits = (smallNuimber) => {
  return new BN(smallNuimber).mul(new BN(10).pow(new BN(18)))
}
const advanceByHours = async (hours) => {
  await advanceTimeAndBlock(hours * hour)
};
/**
 * Used to advance time with expectations.
 */
const safeAdvanceBlockTime = async time => {
  const blockBefore = await getLatestBlock();
  const blockAfter = await advanceTimeAndBlock(time);
  expect(blockAfter.timestamp - blockBefore.timestamp).to.be.gte(time);

  return parseInt(blockAfter.timestamp.toString());
};


const aroundIsh = async (amount, _expectedAmount, error, expPrecision = 6) => {

  amount = typeof amount == 'object' ? amount : new BN(amount);
  let expectedAmount = _expectedAmount;
  expectedAmount = typeof expectedAmount == 'object' ? expectedAmount : new BN(expectedAmount);

  const precisionBounds = (number, precision) => {
    return {
      upper: number.mul(precision).div(precision.sub(new BN(1))),
      lower: number.mul(precision).div(precision.add(new BN(1)))
    }
  }

  expectedAmount = precisionBounds(expectedAmount, new BN(10).pow(new BN(expPrecision))); // 10^6 precision

  await assert(amount.gte(expectedAmount.lower), `${error} | ${amount/1e18} is too small. Expecting ${_expectedAmount/1e18}`);
  await assert(amount.lte(expectedAmount.upper), `${error} | ${amount/1e18} is too large. Expecting ${_expectedAmount/1e18}`);
}

function BNwithCommas(x) {
  return numberWithCommas(x.toString());
}


const humanRadable = (bn) => {
  bn = new BN(bn)
  return `${BNwithCommas(bn)} (${BNwithCommas(bn.div(new BN(10).pow(new BN(18))))})`
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}