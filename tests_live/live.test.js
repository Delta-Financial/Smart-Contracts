
const ethWallet = require('ethereumjs-wallet');

const { expectRevert, BN } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const ganache = require("ganache-core");
const { assert, artifacts } = require('hardhat');
const hre = require("hardhat");


const RebasingLiquidityTokenMock = artifacts.require("RebasingLiquidityTokenMock");
const Distributor = artifacts.require('DELTA_Distributor');

// DELTA
const DELTAToken = artifacts.require('DELTAToken');
const snapshot = require('./snapshot');
const { advanceTimeAndBlock } = require('./timeHelpers');
const constants = require('./constants');
const advanceByHours = async (hours) => {
    await advanceTimeAndBlock(60 * 60 * hours);
}

const impersonate = async (address) => {
    console.log(`Impersonating ${address}`)
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [address]
    })
}

contract('LGE Live Tests', ([x3, pervert, rando, joe, john, trashcan,ape1,ape2]) => {
    afterEach(async function () {
        this.timeout(120000)

        console.log(`Reverting to snapshot ${this.snapshotId}`);
        await snapshot.revertToSnapshot(this.snapshotId);
    });

    beforeEach(async function () {
        this.timeout(120000)
        impersonate("0x5a16552f59ea34e44ec81e58b3817833e9fd5436");
        this.snapshotId = await snapshot.takeSnapshot();
        console.log(`Took snapshot ${this.snapshotId}`);
        this.owner = "0x5A16552f59ea34E44ec81E58b3817833E9fD5436";
        this.OxRevertMainnetAddress = '0xd5b47B80668840e7164C1D1d81aF8a9d9727B421';
    });

    // Pretty format a number
    const pf = (value) => {
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    // Returns number n raised to the e'th power as a bignumber
    const nmBN = (n, m) => {
        return (new BN(n)).pow(new BN(m));
    }

    // Returns number n multiplied by 10 the the 18th power (ne18) as a bignumber
    const ne18BN = (n) => {
        return (new BN(n)).mul( nmBN(10, 18) );
    }

    // Returns a token quantity as BN like pass in 50, you get 50e18 tokens
    const toksBN = (qty) => {
        return (new BN(qty)).mul( (new BN(10)).pow(new BN(18)) );
    }

    // TODO: Test amounts when you send tokens to weird places like the a burn address, sending to contract, sending to dfv, sending to uniswap pair, sending to self, etc.

    xit("Handles expired buckets without spending immature ones that are in the previous bucket", async function() {
        this.timeout(120000);
        const currentTimestamp = async () => {
            const block = await web3.eth.getBlock("latest");
            return block.timestamp;
        }
        await advanceTimeAndBlock(parseInt(10000000)); // TODO: uncomment this and make sure tests pass
        const startTimestamp = await currentTimestamp();
        const xrevert = "0xd5b47b80668840e7164c1d1d81af8a9d9727b421";
        
        await impersonate(constants.CORE_MULTISIG);

        const rebasingTokenMock = await RebasingLiquidityTokenMock.new();
        let deltaToken;
        while(!deltaToken) {
            try {
                deltaToken = await DELTAToken.new(constants.CORE_MULTISIG, rebasingTokenMock.address, constants.CORE_MULTISIG, { from: constants.CORE_MULTISIG });
            }
            catch(e) {
                console.log(e);
            }
        }
        let distributor = await Distributor.new(deltaToken.address, "0x0000000000000000000000000000000000000000", { from: constants.CORE_MULTISIG });
        deltaToken.setDistributor(distributor.address, { from: constants.CORE_MULTISIG });

        const startBalance = (await deltaToken.balanceOf(constants.CORE_MULTISIG)).toString();
        let startBalanceBN = new BN(startBalance);
        console.log(`TXORDERTST:: "didnt have 45M tokens at the beginning"`);
        assert(startBalanceBN.eq(ne18BN(45000000)), "TXORDERTST:: didnt have 45M tokens at the beginning");


        // await advanceTimeAndBlock(parseInt(500000));

        await impersonate(constants.CORE_MULTISIG);
        // Send xrevert 50,000 tokens
        const amount = toksBN(50000);
        // const epochIndex = await deltaToken.currentEpochIndex();
        // console.log(`TXORDERTST:: epochIndex: ${epochIndex.toString()}`);
        await deltaToken.transfer(xrevert, amount, { from: constants.CORE_MULTISIG });
        console.log(`TXORDERTST:: sent 50k tokens from multisig to xrevert`);
        // const epochIndexAfterTransfer = await deltaToken.currentEpochIndex();
        console.log(`TXORDERTST:: xrevert balance is: ${(await deltaToken.balanceOf(xrevert)).toString()} ${((await deltaToken.balanceOf(xrevert)).div(ne18BN(1))).toString()}`);
        // assert(epochIndex.eq(epochIndexAfterTransfer), "TXORDERTST:: Test only works if the epoch isn't changing right at the time of test");

        const revertBalance = await deltaToken.balanceOf(xrevert);
        console.log(`revert balance: ${revertBalance.toString()} ${revertBalance.div(ne18BN(1)).toString()}`);
        assert(revertBalance.eq(ne18BN(5000)), `TXORDERTST:: Initial send didnt send correct tokens
TXORDERTST:: expected ${ne18BN(5000).toString()}
TXORDERTST:: actual ${revertBalance.toString()}
        `);

        const QTY_EPOCHS = await deltaToken.QTY_EPOCHS();
        const SECONDS_PER_EPOCH = (await deltaToken.SECONDS_PER_EPOCH());
        const almostFullVestingDuration = SECONDS_PER_EPOCH.mul(QTY_EPOCHS.sub(new BN(1))); // Go until the 2nd-to-last epoch
        await advanceTimeAndBlock(parseInt(almostFullVestingDuration));
        const newEpochIndex = await deltaToken.currentEpochIndex();
        console.log(`TXORDERTST:: Doing a second transfer to get in the 2nd-to-last bucket.
TXORDERTST:: advanced ${almostFullVestingDuration} seconds (13 days)
TXORDERTST:: Current epoch index: ${newEpochIndex.toString()}
        `);

        // Transfer the same amount of tokens now that it's 13 epochs later
        console.log("TXORDERTST:: Performing send of 50k more tokens to revert");
        await deltaToken.transfer(xrevert, amount, { from: constants.CORE_MULTISIG });
        // Advance one more day
        console.log("TXORDERTST:: Advancing one more day...");
        await advanceTimeAndBlock(parseInt(SECONDS_PER_EPOCH));
        const newEpochIndex2 = await deltaToken.currentEpochIndex();
        console.log(`TXORDERTST:: Current epoch index: ${newEpochIndex2.toString()}`);
        // The bug is that sending from xrevert now will use the immature balance. Let's see...
        let revertBalancePreSend = await deltaToken.balanceOf(xrevert);
        console.log(`TXORDERTST:: new balance for revert: ${revertBalancePreSend.toString()} (${revertBalancePreSend.div(ne18BN(1)).toString()})`);

        await impersonate(xrevert);
        console.log(await deltaToken.totalsForWallet(xrevert));
        const immatureBeforeSend = (await deltaToken.totalsForWallet(xrevert)).immature;
        console.log(`TXORDERTST:: sending 8k coins from revert back to multisig`);
        await deltaToken.transfer(constants.CORE_MULTISIG, ne18BN(8000), { from: xrevert });
        const immatureAfterSend = (await deltaToken.totalsForWallet(xrevert)).immature;

        assert(immatureBeforeSend == immatureAfterSend, "Expected to not use immature balance when sending a tx that should be paid for with an existing mature tx");

    })



    xit("Handles DELTA tokens correctly", async function() {
        this.timeout(120000);

        const rebasingTokenMock = await RebasingLiquidityTokenMock.new();
        let deltaToken;
        while(!deltaToken) {
            try {
                deltaToken = await DELTAToken.new(constants.CORE_MULTISIG, rebasingTokenMock.address, constants.CORE_MULTISIG, { from: constants.CORE_MULTISIG });
            }
            catch(e) {
                console.log(e);
            }
        }
        let distributor = await Distributor.new(deltaToken.address, "0x0000000000000000000000000000000000000000", { from: constants.CORE_MULTISIG });
        deltaToken.setDistributor(distributor.address, { from: constants.CORE_MULTISIG });
        
        
        const startBalance = (await deltaToken.balanceOf(constants.CORE_MULTISIG)).toString();
        let startBalanceBN = new BN(startBalance);
        console.log(`test: "didnt have 45M tokens at the beginning"`);
        assert(startBalanceBN.eq(ne18BN(45000000)), "didnt have 45M tokens at the beginning");

        const xrevert = "0xd5b47b80668840e7164c1d1d81af8a9d9727b421";
        // Transfer half the tokens to xrevert
        await impersonate(constants.CORE_MULTISIG);
        const amount = (new BN("50000")).mul(ne18BN(1));
        console.log("!! State Change !! live.test.js - SEND xrevert 50k tokens");
// SC: SEND xrevert 50k tokens
        await deltaToken.transfer(xrevert, amount, { from: constants.CORE_MULTISIG });

        // await verifySupply(deltaToken);

        // Test that the sender had their tokens reduced equal to the amount of the send
        const newDeltaBalance = new BN(await deltaToken.balanceOf(constants.CORE_MULTISIG));
        console.log(newDeltaBalance.div(ne18BN(1)).toString());
        console.log(`test: "should not have all 50k tokens after sending half out"`);
        assert(newDeltaBalance.eq(ne18BN(44950000)), "should not have all 50k tokens after sending half out");

        // The recipient should have at least 10% of their tokens vested right now
        const newRevertBalance = new BN(await deltaToken.balanceOf(xrevert));
        const initalTenPercent = ne18BN(5000); // The initial vested 10% that happens upon any transfer (5k tokens in this case)
        console.log(`"didnt have at least 5k (10% of the sent) tokens after being sent 50k"`);
        assert(newRevertBalance.gte(initalTenPercent), `${newRevertBalance} not at least ${initalTenPercent} (10% of the sent) tokens after being sent 50k`);

        // You can calculate the exact amount by considering everything in all of their vesting buckets, and the percentage complete of the current bucket

        const SECONDS_PER_EPOCH = new BN("172800");
        const pBlock = await web3.eth.getBlock("latest");
        const timestamp = pBlock.timestamp;

        // Helper to get the percentage an epoch is over - commonly needed for many balance tests
        const percentBucketVestedE18 = (timestamp, currentBlockEpoch) => {
            const secondsPassedInThisEpoch = (new BN(timestamp)).sub(currentBlockEpoch.mul(SECONDS_PER_EPOCH));
            return secondsPassedInThisEpoch.mul(ne18BN(1)).div(SECONDS_PER_EPOCH); // multiplied by 1e18 for precision
        }

        // Here we expect their tokens should have been split over all the buckets (with QTY_EPOCHS total buckets)
        const QTY_EPOCHS = await deltaToken.QTY_EPOCHS();

        const timestampBN = new BN(timestamp);
        const fullVestingDuration = SECONDS_PER_EPOCH.mul(QTY_EPOCHS); // 14 days to vest
        const vestingTimeOfTxSoFar = timestampBN.sub(currentEpoch);
        const percentMaturedSoFar = vestingTimeOfTxSoFar.div(fullVestingDuration);
        const maturedSoFar = percentMaturedSoFar.mul(new BN(50000));
        console.log(`
        timestampBN: ${timestampBN}
        fullVestingDuration: ${fullVestingDuration}
        vestingTimeOfTxSoFar: ${vestingTimeOfTxSoFar}
        percentMaturedSoFar: ${percentMaturedSoFar}
        maturedSoFar: ${maturedSoFar}
        `);
        
        const expectedTotalTokensForRevert = maturedSoFar.add(initalTenPercent);
        console.log(`test: tokens in balance equals expected balance after an epoch passes`)
        console.log(`balance: ${newRevertBalance} (${newRevertBalance.div(ne18BN(1))})`);
        console.log(`expect balance: ${expectedTotalTokensForRevert} (${expectedTotalTokensForRevert.div(ne18BN(1))})`)
        assert(newRevertBalance.eq(expectedTotalTokensForRevert), `Didn't have exactly ${expectedTotalTokensForRevert} ${expectedTotalTokensForRevert.div(ne18BN(1))}`);
        console.log("✅ Balance should increase after advancing an epoch");

        const currentTimestamp = async () => {
            const block = await web3.eth.getBlock("latest");
            return block.timestamp;
        }
        console.log(`Starting time advancing tests at ${(await currentTimestamp())}`);
        // Advance at least 1 more epoch by going 1 epoch + 1 hour in to the future
        let secondsToAdvance = SECONDS_PER_EPOCH;
// SC: Advance time by 24 hours
        console.log("!! State Change !! live.test.js - Advance time by 24 hours");
        await advanceTimeAndBlock(parseInt(secondsToAdvance));
        // await verifySupply(deltaToken);
        console.log(`live.test.js -- Advanced to ${(await currentTimestamp())} -- (${secondsToAdvance/60/60/24} days)`);
        const revertsActualBalanceAfterAdvancingAnEpoch = new BN(await deltaToken.balanceOf(xrevert));
        let pVesting = new BN(0);
        let pStale = new BN(0);
        // const pBalance = ne18BN(5000).add(dustQty); //new BN(5000); // This is hard-coded because we happen to know the 5k is all thats in balance (plus the same extra dust from before)
        const qBlock = await web3.eth.getBlock("latest");
        console.log(`secondsToAdvance: ${secondsToAdvance} fullVestingDuration: ${fullVestingDuration}`)
        const percentVested =
            (
                secondsToAdvance.mul(
                    nmBN(10,4)
                )
                .div(fullVestingDuration)
                .mul(new BN(9)).div(new BN(10))
            )
            .add(new BN(1000));
        console.log(`live.test.js: percentvested: ${percentVested}`);
        const revertsExpectedBalanceAfterAnEpochPassed = percentVested.mul(ne18BN(50000)).div(new BN(1e4));
        console.log(`Balance after epoch passed: ${revertsActualBalanceAfterAdvancingAnEpoch} (${revertsActualBalanceAfterAdvancingAnEpoch.div(ne18BN(1))})`);
        assert(revertsActualBalanceAfterAdvancingAnEpoch.gt(newRevertBalance), "Balance should increase after advancing an epoch");
        assert(revertsActualBalanceAfterAdvancingAnEpoch.eq(revertsExpectedBalanceAfterAnEpochPassed), `Balance should equal ${revertsExpectedBalanceAfterAnEpochPassed} (${revertsExpectedBalanceAfterAnEpochPassed.div(ne18BN(1))}) after advancing an epoch`);
        console.log("✅ Balance should increase after advancing an epoch");
        console.log("✅ Balance matches pre-calculated values after advancing an epoch");

        // Now send a transaction on this 1 day later (only 10% + 1/14th vested, about 17.142% of the total 50k is about 8,571 vested)
        // If reverts sends 10,000 tokens at this moment, it should fail because he doesn't have that much vested
        await impersonate(xrevert);
        const ramt = (new BN("10000")).mul(ne18BN(1));
        await expectRevert(deltaToken.transfer(x3, ramt, { from: xrevert }), "DELTAToken:: Insufficent transaction output");
        // await verifySupply(deltaToken);
        console.log("✅ Sending out more coins than are vested reverts, as expected.");

        // If revert sends 1,000 tokens at this moment, he should expect it to succeed,
        // but to burn some unvested. There are 13 days remaining in the vesting period.
        // He starts at 10% vested at the first moment of vesting.
        // So, you scale down the 1/14th of the progress to only represent 90%
        // of the total vesting schedule, you get 7.14% => 6.42%
        // Then add the initial 10% to get: 16.42% vested after 1 epoch,
        // plus a little more depending on how long has passed since the new epoch.
        // In this test that "little more" is literally only 1 seconds, which we can
        // round down to 0 since we lack precision to see a second-by-second vesting.
        //
        // So, if revert is effectively 16.42% vested on his tokens, then you expect
        // to burn lots of coins in this case. In particular you should burn a qty
        // where 16.42% of A = 1000, which is about 6,090.133.
        // This should leave the initial transaction with ~= 43,909 coins
        // while also still only being 16.42% vested. So the balance then would
        // be 16.42% of ~= 43,909 which is ~= 7,209
        // I rounded these values for clarity and easy math, but the full math would be:
        // (50000 - (1000 / (1 / 14 * 9 / 10 + 10/100))) * (1 / 14 * 9 / 10 + 10/100)
        // This initial vested percenage can be represented V = (1 / 14 * 9 / 10 + 10/100)
        // Then the equation for the new balance (B) becomes
        // B = (50000 - (1000 / V)) * V
        // B = 50,500 / 7 ~= 7214.285714285715
        // The solidity code will round some values off since we convert them to lossy decimals,
        // and in this case it ends up being around 7210.
        
        // Transfer half the tokens to xrevert
        await impersonate(xrevert);
        const jamt = ne18BN(1000); // (new BN("1000")).mul(ne18BN(1));

// SC: SEND x3 1k tokens, burn a bunch
        await deltaToken.transfer(x3, jamt, { from: xrevert });

        // await verifySupply(deltaToken);
        console.log("🤙 🤙 🤙 🤙");
        console.log(`preburn balance: ${revertsActualBalanceAfterAdvancingAnEpoch} (${revertsActualBalanceAfterAdvancingAnEpoch.div(ne18BN(1))})`);
        const postBurnBalance = await deltaToken.balanceOf(xrevert);
        const tokenQtyExpectedAfterBurn = ne18BN(7210);
        console.log(`postBurnBalance: ${postBurnBalance} (${postBurnBalance.div(ne18BN(1))})`);
        console.log(`tokenQtyExpectedAfterBurn: ${tokenQtyExpectedAfterBurn} (${tokenQtyExpectedAfterBurn.div(ne18BN(1))})`);
        assert(postBurnBalance.eq(tokenQtyExpectedAfterBurn), `Didn't burn adequate coins after immature send. Expected ${tokenQtyExpectedAfterBurn.div(ne18BN(1))} tokens, found ${postBurnBalance.div(ne18BN(1))} tokens`);
        console.log(" ✅ Burned adequate coins after immature send.");



        // At 16.42% vested we were let with 7,210 tokens. Which means there are still a total balance of ~ 43,909.8
        const fullVestingTime = QTY_EPOCHS.mul(SECONDS_PER_EPOCH);
// SC: Advance time by the full vesting time
        await advanceTimeAndBlock(fullVestingTime);
        // await verifySupply(deltaToken);
        const weekSeconds = 604800;
        console.log(`2*weeksseconds: ${2*weekSeconds}  fullVestingTime.toString(): ${fullVestingTime.toString()}`)
        /*await advanceTime(2*weekSeconds);
        */
        // 2 weeks later we send the rest of the coins that are all totally vested
        const expectedBalance = new BN('43909866017052375152254');
        console.log(`revert balance: ${(await deltaToken.balanceOf(xrevert))}`)
        console.log(`expected balance: ${expectedBalance}`);
        assert((await deltaToken.balanceOf(xrevert)).eq(expectedBalance));
        
// SC: Transfer 1500 coins to x3 from revert
        await deltaToken.transfer(x3, ne18BN(1500), { from: xrevert });
        // await verifySupply(deltaToken);

        console.log(`😻 revert balance postsend: ${await deltaToken.balanceOf(xrevert)}`);
        console.log((await web3.eth.getBlock("latest")).timestamp);
        const postMatureBalance = await deltaToken.balanceOf(xrevert);
        const postMatureBalanceExpected = expectedBalance.sub(ne18BN(1500));
        console.log(`postMatureBalanceExpected: ${postMatureBalanceExpected}\npostMatureBalance: ${postMatureBalance}`);
        assert(postMatureBalanceExpected.eq(postMatureBalance), `Didn't have correct coins after mature send. Expected ${postMatureBalanceExpected.div(ne18BN(1))} tokens, found ${postMatureBalance.div(ne18BN(1))} tokens`);


        // TODO: Test that making subsequent transactions, and therefore updating the fullyVestedTimestamp, doesnt produce incorrect balances

        // TOOD: Transfer entire supply to immature wallet
        // TOOD: Transfer entire supply from immature wallet

    });


    function humanReadableDisplayAmounts(amount) {
      return `${amount.div(ne18BN(1))} tokens ${amount} with decimals`;
    }

    const getAddresProperties = {
      'revert' : {
        address :"0xd5b47b80668840e7164c1d1d81af8a9d9727b421",
        isFullSender : false,
        isImmatureReciever : false,
        isNoVesting : false
      },
      'x3' : {
        address : x3,
        isFullSender : false,
        isImmatureReciever : false,
        isNoVesting : false
      },
      'multisig' : {
        address : constants.CORE_MULTISIG,
        isFullSender : true,
        isImmatureReciever : true,
        isNoVesting : true
      },
      'ape1' : {
        address : ape1,
        isFullSender : false,
        isImmatureReciever : false,
        isNoVesting : false
      },
      'ape2' : {
        address : ape2,
        isFullSender : false,
        isImmatureReciever : false,
        isNoVesting : false
      },
      'immatureReciever' : {
        address : trashcan,
        isFullSender : false,
        isImmatureReciever : true,
        isNoVesting : false
      },
      'noVesting' : {
        address : joe,
        isFullSender : false,
        isImmatureReciever : false,
        isNoVesting : true
      },
    } 

    const ZERO = new BN (0);
    const tenProcentOfAmount = (amount) => amount.mul(new BN(0.1));
    const turnBNNegative = (bn) => bn.sub(bn.mul(new BN(2)));

    const getBalanceChangesWithSend = async (deltaToken, sendAmount, senderAddress, recieverAddress) => {
      /// We conduct the send.
      const totalsForSenderBefore = await deltaToken.totalsForWallet(senderAddress);
      const totalsForRecieverBefore = await deltaToken.totalsForWallet(recieverAddress);
      const maxBalanceSenderBefore = (await deltaToken.userInformation(senderAddress)).maxBalance;
      const maxBalanceRecieverBefore = (await deltaToken.userInformation(recieverAddress)).maxBalance;
      console.log('\n');
      await deltaToken.transfer(recieverAddress, sendAmount, {from : senderAddress});
      console.log('\n');
      const totalsForSenderAfter = await deltaToken.totalsForWallet(senderAddress);
      const totalsForRecieverAfter = await deltaToken.totalsForWallet(recieverAddress);
      const maxBalanceSenderAfter = (await deltaToken.userInformation(senderAddress)).maxBalance;
      const maxBalanceRecieverAfter = (await deltaToken.userInformation(recieverAddress)).maxBalance;
      const toToReturn = {
          recieverChanges : getBalanceChanges(totalsForRecieverBefore, totalsForRecieverAfter, maxBalanceRecieverBefore, maxBalanceRecieverAfter),
          senderChanges : getBalanceChanges(totalsForSenderBefore, totalsForSenderAfter, maxBalanceSenderBefore,maxBalanceSenderAfter)
      }
      console.log('\n');
      console.log(`🤝💰 Changes with send of ${humanRadable(sendAmount)} 💰🤝`)
      console.log('\n');

      return toToReturn;
  
    }

    const assertChanges = async (amount, changesObject,expectedChanges, fromAndTo, typeWallet) => {
              //  maxBalance : {changeOfAmountExact : -100}, 
              // burnedAmount : {changeOfAmountMin : 0, changeOfAmountMax : -900},

          const getChangesForBalance = (expectedChange) => {
            
            let exactly = expectedChange.changeOfAmountExact != undefined;

            if(amount.isZero()) {

              exactly = true;
              expectedChange.changeOfAmountExact = ZERO;

            }
            


            return {
              exact : exactly ? amount.mul(new BN(expectedChange.changeOfAmountExact)).div(new BN(100)) : null,
              topBound: exactly ? 0 : amount.mul(new BN(expectedChange.changeOfAmountMax)).div(new BN(100)),
              bottomBound : exactly ? 0 : amount.mul(new BN(expectedChange.changeOfAmountMin)).div(new BN(100)),
            }
          }

          const calculatedChanges = {
            mature : getChangesForBalance(expectedChanges.mature),
            immature : getChangesForBalance(expectedChanges.immature),
            total : getChangesForBalance(expectedChanges.total),
            maxBalance : getChangesForBalance(expectedChanges.maxBalance),
            burnedAmount : getChangesForBalance(expectedChanges.burnedAmount),
           
          }

 
          if(changesObject.timeChanges == undefined) {
            if(changesObject.mature.isNeg()) {
              changesObject.burnedAmount = changesObject.mature.add(changesObject.immature).add(amount);

            } else {
              changesObject.burnedAmount = changesObject.mature.add(changesObject.immature).sub(amount);

            }
          } else {
          
            changesObject.burnedAmount = changesObject.mature.add(changesObject.immature)
            // Immature is always ---
            // mature is always ++ to cancel u have to do this
          }


          console.log(`${typeWallet.charAt(0).toUpperCase() + typeWallet.slice(1)} changes`)
          printChanges(changesObject, calculatedChanges);

          await assertChange(
            changesObject.burnedAmount,
            calculatedChanges.burnedAmount,
            typeWallet,
            'burnedAmount',
            fromAndTo
          );

          await assertChange(
            changesObject.mature,
            calculatedChanges.mature,
            typeWallet,
            'mature',
            fromAndTo
          );
          
          if(changesObject.immature) {
            await assertChange(
              changesObject.immature,
              calculatedChanges.immature,
              typeWallet,
              'immature',
              fromAndTo
            );
          }

          await assertChange(
            changesObject.total,
            calculatedChanges.total,
            typeWallet,
            'total',
            fromAndTo
          );

          await assertChange(
            changesObject.maxBalance,
            calculatedChanges.maxBalance,
            typeWallet,
            'maxBalance',
            fromAndTo
          );
    }

    const assertChange = async (change, expectedChange, typeWalet,typeCheck, fromAndTo) => {
      const {from,to} = fromAndTo;

      if(typeof change != 'object') {
        throw new Error("Change passed in assertChange() isn't an object(BN)");
      }

      if(expectedChange.exact != null && typeof expectedChange.exact != 'object') {
        throw new Error("expectedChange.exact passed in assertChange() isn't an object(BN)");
      } 

      if(expectedChange.exact == null && (typeof expectedChange.bottomBound != 'object' || typeof expectedChange.topBound != 'object') ) {
          throw new Error("expectedChange.bottomBound  or topBound passed in assertChange() isn't an object(BN)");
      }

      if(expectedChange.exact == null && expectedChange.bottomBound.eq(expectedChange.topBound)) {
          throw new Error("top bound and bottom bound cannot be equal!");
      }

      const expectedChangeTextAround = () => {
        if(expectedChange.bottomBound.isNeg()) {
          return `get substracted ${humanRadable(expectedChange.bottomBound)} to ${humanRadable(expectedChange.topBound)} in`
        }
        return `to gain${humanRadable(expectedChange.bottomBound)} to ${humanRadable(expectedChange.topBound)} in `
      }

      const expectedChangeTextExact = () => {
        if(expectedChange.exact.isNeg()) {
          return `to get substraction for ${humanRadable(expectedChange.exact)} in `
        }
        if(expectedChange.exact.isZero()) {
          return `to have no change in`
        }
        return `to get ${humanRadable(expectedChange.exact)} in `
      }
  
      if(expectedChange.exact != null) {
        const errorMessage = `When sending from ${from} to ${to} we expected ${typeWalet} ${expectedChangeTextExact()} ${typeCheck}`
        await assert(change.eq(expectedChange.exact),errorMessage);
      }
      else {
        const errorMessage = `When sending from ${from} to ${to} we expected ${typeWalet} ${expectedChangeTextAround()} ${typeCheck}`
        if(expectedChange.topBound.isNeg() ) {
          await assert(change.lte(expectedChange.bottomBound),errorMessage);
          await assert(change.gte(expectedChange.topBound),errorMessage);
        } else {
          await assert(change.gte(expectedChange.bottomBound),errorMessage);
          await assert(change.lte(expectedChange.topBound),errorMessage);
        }


      }

    }

    const assertChangesForSenderAndReciever = async (amount ,changesObject, expectedChanges, names) => {
     
      await assertChanges (
        amount,
        changesObject.recieverChanges, 
        expectedChanges.reciever,
        names,
        'reciever'
      );

      await assertChanges (
        amount,
        changesObject.senderChanges, 
        expectedChanges.sender,
        names,
        'sender'
      );

    }


    const getBalanceChangesWithTime = async (deltaToken, waitTime, senderAddress, recieverAddress ) => {
      /// We conduct the send.
      const totalsForSenderBefore = await deltaToken.totalsForWallet(senderAddress);
      const totalsForRecieverBefore = await deltaToken.totalsForWallet(recieverAddress);
      const maxBalanceSenderBefore = (await deltaToken.userInformation(senderAddress)).maxBalance;
      const maxBalanceRecieverBefore = (await deltaToken.userInformation(recieverAddress)).maxBalance;
      await advanceTimeAndBlock(waitTime);
      const totalsForSenderAfter = await deltaToken.totalsForWallet(senderAddress);
      const totalsForRecieverAfter = await deltaToken.totalsForWallet(recieverAddress);
      const maxBalanceSenderAfter = (await deltaToken.userInformation(senderAddress)).maxBalance;
      const maxBalanceRecieverAfter = (await deltaToken.userInformation(recieverAddress)).maxBalance;
      const toToReturn = {
          recieverChanges : {timeChanges : true, ...getBalanceChanges(totalsForRecieverBefore, totalsForRecieverAfter, maxBalanceRecieverBefore,maxBalanceRecieverAfter)},
          senderChanges : {timeChanges : true, ...getBalanceChanges(totalsForSenderBefore, totalsForSenderAfter, maxBalanceSenderBefore,maxBalanceSenderAfter)},
      }
      console.log('\n');
      console.log(`⏲️⏲️ Changes with time of ${waitTime} seconds (${waitTime/60/60} hours) ⏲️⏲️`)
      console.log('\n');

      return toToReturn;
  
    }

        function numberWithCommas(x) {
          return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    } 

    function BNwithCommas(x) {
      return numberWithCommas(x.toString());
    }


    const humanRadable = (bn) => {
      return `${BNwithCommas(bn)} (${BNwithCommas( bn.div( new BN(10).pow(new BN(18)) ))})`
    }

    const printChanges = (actualChanges, expectedChanges) => {

      const getExpectedText = (expected) => {
        if(expected.exact != null) {
          return humanRadable(expected.exact);
        }

        return `Min ${humanRadable(expected.bottomBound)} Max ${humanRadable(expected.topBound)}`
      }




      console.table({ 
        mature : {
          actual : humanRadable(actualChanges.mature),
          expected : getExpectedText(expectedChanges.mature),
        },
        immature : {
          actual : humanRadable(actualChanges.immature),
          expected : getExpectedText(expectedChanges.immature),
        },
        total : {
          actual : humanRadable(actualChanges.total),
          expected : getExpectedText(expectedChanges.total),
        },
        maxBalance : {
          actual : humanRadable(actualChanges.maxBalance),
          expected : getExpectedText(expectedChanges.maxBalance)
        },
        burnedAmount : {
          actual : humanRadable(actualChanges.burnedAmount),
          expected : getExpectedText(expectedChanges.burnedAmount)
        }

      })


      console.log('\n');
    }


    const getBalanceChanges = (totalsObjectBefore, totalsObjectAfter, maxBalanceObjectBefore, MaxBalanceObjectAfter) => {

      return {
        immature : new BN(totalsObjectAfter.immature).sub(new BN(totalsObjectBefore.immature)),
        mature : new BN(totalsObjectAfter.mature).sub(new BN(totalsObjectBefore.mature)),
        total : new BN(totalsObjectAfter.total).sub(new BN(totalsObjectBefore.total)),
        maxBalance : new BN(MaxBalanceObjectAfter).sub(new BN(maxBalanceObjectBefore))
      }


    }

    const setProperWhiteLists = async (deltaToken, of) => {
        of = getAddresProperties[of];

        //  setWhitelists(address account, bool canSendToMatureBalances, bool canRecieveImmatureBalances, bool recievesBalancesWithoutVestingProcess)
        await deltaToken.setWhitelists(of.address, of.isFullSender, of.isImmatureReciever, of.isNoVesting, {from : constants.CORE_MULTISIG});
    }





    async function transactionFlowTester(transactions, deltaToken) {


      for(i = 0; i < transactions.length; i++) {
        console.count('Loops')

        const {from,to,amount,timeWaitAfter} = transactions[i];
        const fromAndTo = {from,to};

        console.log(`\n ↗️↗️↗️🔝 Sending ${amount} from ${from} ${JSON.stringify(getAddresProperties[from],0,2)} to ${to} ${JSON.stringify(getAddresProperties[to],0,2)} 🔝↗️↗️↗️ \n`);
        console.group();

        await setProperWhiteLists(deltaToken, from);
        await setProperWhiteLists(deltaToken, to);

        const sender = getAddresProperties[from];
        const reciever = getAddresProperties[to];


        const senderAddress = sender.address;
        const recieverAddress = reciever.address;
        await impersonate(senderAddress);
        



        if(sender.isFullSender || reciever.noVesting) {
          console.log("The sender is a full sender or the reciever has no vesting, running checking logic for that branch")
          // If the sender is ful sender, we expect that the reciever got it all into mature, and sender got it all from his mature

          const changes = await getBalanceChangesWithSend(deltaToken,amount,senderAddress,recieverAddress);

          await assertChangesForSenderAndReciever(amount, changes,
          {
            sender : {
              mature : {changeOfAmountExact : -100},
              total : {changeOfAmountExact : -100},
              maxBalance : {changeOfAmountExact : -100}, 
              burnedAmount : {changeOfAmountMin : 0, changeOfAmountMax : -900},
              immature : {changeOfAmountMin : 0, changeOfAmountMax : -900},
            },
            reciever : {
              mature : {changeOfAmountExact : 100},
              total : {changeOfAmountExact : 100},
              maxBalance : {changeOfAmountExact : 100}, 
              burnedAmount : {changeOfAmountExact : 0},
              immature : {changeOfAmountExact : 0},
            }
          }, 
          fromAndTo);

          const changesWithTime = await getBalanceChangesWithTime(deltaToken, timeWaitAfter, senderAddress, recieverAddress);

          await assertChangesForSenderAndReciever(ZERO, changesWithTime,
          {
            sender : {
              mature : {changeOfAmountExact : 0},
              total : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 0}, 
              burnedAmount : {changeOfAmountExact : 0},
              immature : {changeOfAmountExact : 0},
            },
            reciever : {
              mature : {changeOfAmountExact : 0},
              total : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 0}, 
              burnedAmount : {changeOfAmountExact : 0},
              immature : {changeOfAmountExact : 0},
            }
          }, 
          fromAndTo)

        } 



        else if(!sender.isFullSender && !reciever.isNoVesting && !reciever.isImmatureReciever) {
          console.log("Reciever and sender are both normal, proceeding with a test of a normal send.")
          const changes = await getBalanceChangesWithSend(deltaToken,amount,senderAddress,recieverAddress);

          await assertChangesForSenderAndReciever(amount, changes,
          {
            sender : {
              mature : {changeOfAmountExact : -100},
              total : {changeOfAmountExact : -100},
              maxBalance : {changeOfAmountExact : -100}, 
              burnedAmount : {changeOfAmountMin : 0, changeOfAmountMax : -900},
              immature : {changeOfAmountMin : 0, changeOfAmountMax : -900},
            },
            reciever : {
              mature : {changeOfAmountExact : 10},
              immature : {changeOfAmountExact : 90},
              total : {changeOfAmountExact : 100},
              maxBalance : {changeOfAmountExact : 100},
              burnedAmount : {changeOfAmountExact : 0},
            }
          }, 
          fromAndTo)

          const changesWithTime = await getBalanceChangesWithTime(deltaToken, timeWaitAfter, senderAddress, recieverAddress);
          /// The assertChangesForSenderAndReciever bases the numbers based on amount, so amount for maturing here might be 90% of the amount
          const ninentyPercentOfAmount = amount.mul(new BN(9)).div(new BN(10));

          const getPercentComplete = (timeSeconds) => {
            let float = timeSeconds*100/1209600;//2w
            if(float > 100) {
              float = 100;
            }
            return  new BN(float);
          }
          const completePercent = getPercentComplete(timeWaitAfter);
          console.log("We waited sec",timeWaitAfter)
          console.log("So vesting is.. ", completePercent.toString() ,"%")

          console.log("So vested change is .. ", humanRadable( completePercent.mul(ninentyPercentOfAmount).div(new BN(100))) )


          await assertChangesForSenderAndReciever(ninentyPercentOfAmount, changesWithTime,
          {
            sender : {
              mature : {changeOfAmountExact : 0},
              total : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 0}, 
              burnedAmount : {changeOfAmountExact : 0},
              immature : {changeOfAmountExact : 0},
            },
            reciever : {
              mature : {changeOfAmountMin : completePercent, changeOfAmountMax : completePercent.add(new BN(1))},
              total : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 0}, 
              burnedAmount : {changeOfAmountExact : 0},
              immature : {changeOfAmountMin: turnBNNegative(completePercent), changeOfAmountMax : turnBNNegative(completePercent.add(new BN(1)))},
            }
          }, 
          fromAndTo)

          // TODO Add changes with time const changesWithTime = await getBalanceChangesWithTime(deltaToken, timeWaitAfter, senderAddress, recieverAddress);
          // But have to get a way to calculate expected


        }

        else if(reciever.isImmatureReciever) {
          console.log("Reciever is a immature reciever. Sending from the immature balances.")

          const changes = await getBalanceChangesWithSend(deltaToken,amount,senderAddress,recieverAddress);

          const senderExpecations = {
              mature : {changeOfAmountMin : -10, changeOfAmountMax : -100},
              total : {changeOfAmountExact : -100},
              immature : {changeOfAmountMin : 0, changeOfAmountMax : -100},
              burnedAmount : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : -100}, 
            }

          let recieverExpectation;


          if(reciever.isNoVesting || sender.isFullSender) {
            console.log("Reciver doesnt have vesting, or sender is full sender, adding directly to mature balances.")
            recieverExpectation =              {
              mature : {changeOfAmountExact : 100},
              total : {changeOfAmountExact : 100},
              immature : {changeOfAmountExact : 0},
              burnedAmount : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 100}, 
            }
          } else {
            recieverExpectation =  {
              mature : {changeOfAmountExact : 10},
              total : {changeOfAmountExact : 100},
              immature : {changeOfAmountExact : 90},
              burnedAmount : {changeOfAmountExact : 0},
              maxBalance : {changeOfAmountExact : 100}, 
            }
          }

          await assertChangesForSenderAndReciever(amount, changes,
          {
            sender : senderExpecations,
            reciever : recieverExpectation
            
          }, 
          fromAndTo)
        }

      

        await advanceByHours(9999999); // TODO REMOVE

        console.groupEnd();
        console.log('\n/\n /*\n');
      }
  }

  const printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero = async (deltaToken, person)=> {

        let buckets = {};
        let hasImmatureZero
        
        for(var i=0;i<7;i++) {
            const transaction = await deltaToken.vestingTransactions(person, i);
            const transactionDetails = await deltaToken.getTransactionDetail([transaction.amount.toString(), transaction.fullVestingTimestamp.toString()]);
            if(transactionDetails.immature == 0) {
              hasImmatureZero =true;
            }
            buckets[i] = {mature : transactionDetails.mature, immature:transactionDetails.immature, amount:transactionDetails.amount, fullVestingTimestamp:transactionDetails.fullVestingTimestamp };
          } 
          console.table(buckets);
          await assert (hasImmatureZero === true, "There is no bucket who has immature of zero, this means the cycle is broken (one of them should always be mature completely when doing 48 intervals)")
      }

    it("Bucket overflow test", async function () {
        this.timeout(12000000);
        const deltaToken = await setupDeltaToken();
        await deltaToken.transfer(ape1, '10000000', {from : constants.CORE_MULTISIG});

        //1
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await advanceByHours(48);
        //2
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await advanceByHours(48);
        console.log("After 48 * 2")
        await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)
        //3
        await deltaToken.transfer(ape2, '100000', {from : ape1});     
        await advanceByHours(48);   
        //4
        await deltaToken.transfer(ape2, '100000', {from : ape1});   
        console.log("After 48 * 4")    
        await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)
        await advanceByHours(24);  
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await advanceByHours(24);   
        //5
        await deltaToken.transfer(ape2, '100000', {from : ape1});  
        await advanceByHours(48);      
        //6
        await deltaToken.transfer(ape2, '100000', {from : ape1});  
        await advanceByHours(48);      
        //7
        await deltaToken.transfer(ape2, '100000', {from : ape1});  
        await advanceByHours(24);  
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await advanceByHours(24);  
        console.log("After 48 * 7")    
        await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)
        //8
        await deltaToken.transfer(ape2, '100000', {from : ape1});  
        await advanceByHours(48);      
        //9
        await deltaToken.transfer(ape2, '100000', {from : ape1});  
        await advanceByHours(48);      
        //10
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await advanceByHours(48);   
        console.log("After 48 * 10")    
        await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)     

        // TODO: Uncomment this. Strangely fails only in the public repo?
        /*const ape2deets = await deltaToken.totalsForWallet(ape2);
        ape2deets.maxBalance = (await deltaToken.userInformation(ape2)).maxBalance;

        await assert(ape2deets.maxBalance.eq(new BN(1200000)),"Max balanace mismatch");
        await assert(new BN(ape2deets.total).eq(new BN(1200000)),"Totals mismatch");
        await assert((await deltaToken.balanceOf(ape2)).lt(new BN(1200000)),"Totals mismatch");

        // We matuer completely
        await advanceByHours(480);   
        await assert((await deltaToken.balanceOf(ape2)).eq(new BN(1200000)),"Totals mismatch");*/



    })

    const balanceShouldBe = async (deltaToken, amount, person) => {
      const balance = await deltaToken.balanceOf(person)
      await assert(balance.toString()=== amount, `Person does not have enough balance expected ${amount} got ${balance.toString()}`);
      return balance
    }

    /// We figure out if we properly include stuff in the buckets when it should be collapsed into one ( less than 2 days)
    it("Bucket inclusion test", async function () {
        this.timeout(12000000);
        const deltaToken = await setupDeltaToken();

        await deltaToken.transfer(ape1, '1000000', {from : constants.CORE_MULTISIG});
        await balanceShouldBe(deltaToken,'1000000', ape1);
        await deltaToken.transfer(ape2, '100000', {from : ape1});
        await balanceShouldBe(deltaToken,'10000', ape2);

        await advanceByHours(24);
        const balanceApe2Before = await deltaToken.balanceOf(ape2);
        const amountSendNew = new BN(100000);
        await deltaToken.transfer(ape2, amountSendNew, {from : ape1});
        const balanceApe2After = await deltaToken.balanceOf(ape2);

        // If its done properly the balance should be more than 10%
        await assert(balanceApe2After.gt(balanceApe2Before.add(amountSendNew.div(new BN(10)))),"Test after 24h, did not bundled");

        // Should still be true with 47h
        await advanceByHours(23);
        const balanceApe2Before2 = await deltaToken.balanceOf(ape2);
        const amountSendNew2 = new BN(100000);
        await deltaToken.transfer(ape2, amountSendNew2, {from : ape1});
        const balanceApe2After2 = await deltaToken.balanceOf(ape2);
        await assert(balanceApe2After2.gt(balanceApe2Before2.add(amountSendNew2.div(new BN(10)))),"Test after 47h, did not bundled");

        /// should no longer be true after
        await advanceByHours(1);
        const balanceApe2Before3 = await deltaToken.balanceOf(ape2);
        const amountSendNew3 = new BN(100000);
        await deltaToken.transfer(ape2, amountSendNew3, {from : ape1});
        const balanceApe2After3 = await deltaToken.balanceOf(ape2);
        await assert(balanceApe2After3.eq(balanceApe2Before3.add(amountSendNew3.div(new BN(10)))),"Test after 48h, did get bundled");

        /// should no longer be true after
        await advanceByHours(1);
        const balanceApe2Before4 = await deltaToken.balanceOf(ape2);
        const amountSendNew4 = new BN(100000);
        await deltaToken.transfer(ape2, amountSendNew4, {from : ape1});
        const balanceApe2After4 = await deltaToken.balanceOf(ape2);
        await assert(balanceApe2After4.gt(balanceApe2Before4.add(amountSendNew4.div(new BN(10)))),"Test after 49h, did not get bunded in bucket 2");
    })

    const setupDeltaToken = async () =>{
        await impersonate(constants.CORE_MULTISIG);

        const rebasingTokenMock = await RebasingLiquidityTokenMock.new();
        let deltaToken;
        while(!deltaToken) {
            try {
                deltaToken = await DELTAToken.new(constants.CORE_MULTISIG, rebasingTokenMock.address, constants.CORE_MULTISIG, { from: constants.CORE_MULTISIG });
            }
            catch(e) {
                console.log(e);
            }
        }
        let distributor = await Distributor.new(deltaToken.address, "0x0000000000000000000000000000000000000000", { from: constants.CORE_MULTISIG });
        await deltaToken.setDistributor(distributor.address, { from: constants.CORE_MULTISIG });
        
        // Skip LP rebasing for now
        await deltaToken.activatePostFirstRebasingState({ from: constants.CORE_MULTISIG });


        // const deltaToken = await DELTAToken.new(constants.CORE_MULTISIG,0);
        const startBalance = (await deltaToken.balanceOf(constants.CORE_MULTISIG)).toString();
        let startBalanceBN = new BN(startBalance);

        assert(startBalanceBN.eq(ne18BN(45000000)), "didnt have 45M tokens at the beginning");

        return deltaToken;
    }


    const randomTest = async (deltaToken, testObject) => {

      const {rkey1, rkey2, rAmount, timeWait, error} = testObject;

      if(error) {
        try {
            await transactionFlowTester(
              new Array(1).fill({
                from: rkey1,
                to : rkey2,
                amount : rAmount,
                timeWaitAfter : timeWait
              }), deltaToken);

          } catch (err) {
            err = err.message.split('at')[0];
            assert(err == error, `Expected error -\n ${error},\n got error -\n ${err}`);
            console.groupEnd()
        }

      } else {

       await transactionFlowTester(
          new Array(1).fill({
            from: rkey1,
            to : rkey2,
            amount : rAmount,
            timeWaitAfter : timeWait
          }), deltaToken)

      }
    }

    const doRandomSeedTest = async (deltaToken, seed ) => {
        // Deterministic random number generation
        var seedrandom = require('seedrandom');
        var rng = seedrandom(seed);
        for(var i=0;i<150;i++) {
          console.log("\n\n\n==========\n\n\n");
          let testAddresses = Object.keys(getAddresProperties);
          let rkey1 = testAddresses[Math.floor(rng() * testAddresses.length)];
          let rkey2 = testAddresses[Math.floor(rng() * testAddresses.length)];
          let timeWait = rng() * 2 * 3.154e7; // up to 2 years delay
          // let rAmount = ((new BN(1e18)).mul( new BN(Math.floor(rng()*100)) )).div(100); // up to 10m coins
          let rAmount = (ne18BN(1).mul(new BN(
            100*rng()
            ))).div(new BN(100));
        
          console.log(`from ${rkey1} to ${rkey2} ${rAmount} with delay ${timeWait}`);
          // await expectRevert(deltaToken.transfer(x3, ramt, { from: xrevert }), "DELTAToken:: Insufficent transaction output");
          const balance1 = await deltaToken.balanceOf(getAddresProperties[rkey1].address);
          const balance2 = await deltaToken.balanceOf(getAddresProperties[rkey2].address);
          console.log("\n\n\n------\n\n\n");
          console.log(`\n\n\n send ${rAmount} (${rAmount.div(ne18BN(1))}) from balance of ${balance1} \n\n\n`);
          console.log("\n\n\n------\n\n\n");

          if(rkey1 == rkey2) {
            await randomTest(deltaToken, {rkey1, rkey2, rAmount, timeWait, error :"VM Exception while processing transaction: revert DELTAToken: Can not send DELTA to yourself"});
          }
          else if(balance1.lt(rAmount)) {
            await randomTest(deltaToken, {rkey1, rkey2, rAmount, timeWait, error :"VM Exception while processing transaction: revert OVLTransferHandler: Insufficient funds"});
          }
          else {
            await randomTest(deltaToken, {rkey1, rkey2, rAmount, timeWait});
          }


          
        }
         
    }


    it("Randomness fuzz testing", async function () {
        this.timeout(12000000);
       
        const deltaToken = await setupDeltaToken();
        await doRandomSeedTest(deltaToken,'deltabeef');
        await doRandomSeedTest(deltaToken,'x3dumb');
        // await doRandomSeedTest(deltaToken,'revertSmart');
        // await doRandomSeedTest(deltaToken,'sanhfkhsafsaghfsaoupy42350gblwfsafasd');
        // await doRandomSeedTest(deltaToken,'2nbfijsab023');


        await transactionFlowTester(
          new Array(20).fill({  /* Creates 20 transactions to be executed in a row */
            from: 'multisig',
            to : 'revert',
            amount : ne18BN(6969),
            timeWaitAfter : 86400 * 2 // 2 days /* Wait this amount of time and check the balance again using logic somewhere in this file */
          })
        , deltaToken);

      await transactionFlowTester(
          new Array(1).fill({
            from: 'multisig',
            to : 'ape1',
            amount : ne18BN(1000000),
            timeWaitAfter : 86400 * 2 // 2 days
          })
        , deltaToken);

        await transactionFlowTester(
          new Array(20).fill({
            from: 'ape1',
            to : 'revert',
            amount : ne18BN(6969),
            timeWaitAfter : 86400 * 2 // 2 days
          })
        , deltaToken);

        const revBalanceAfter = await deltaToken.balanceOf(getAddresProperties['revert'].address);
        console.log(`Balance of revert after 15 transactions of 6969 (tokens and waiting 15 days (most still maturing) ${humanReadableDisplayAmounts(revBalanceAfter)}`)

        await transactionFlowTester(
          [
            ...new Array(5).fill({
              from: 'revert',
              to : 'x3',
              amount : ne18BN(1000),
              timeWaitAfter : 5485
            }),
            ...new Array(3).fill({
              from: 'x3',
              to : 'multisig',
              amount : ne18BN(33),
              timeWaitAfter : 12342
            }),
          ...new Array(4).fill({
              from: 'revert',
              to : 'multisig',
              amount : ne18BN(334),
              timeWaitAfter : 3432
            }),
            ...new Array(4).fill({
              from: 'multisig',
              to : 'x3',
              amount : ne18BN(3344),
              timeWaitAfter : 3535
            }),



          ]
          , deltaToken);
    })


});
