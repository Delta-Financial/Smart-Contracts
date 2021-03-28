const { BN } = require('@openzeppelin/test-helpers');
const { assert, artifacts } = require('hardhat');
const hre = require("hardhat");


const RebasingLiquidityTokenMock = artifacts.require("RebasingLiquidityTokenMock");
const Distributor = artifacts.require('DELTA_Distributor');

// DELTA
const DELTAToken = artifacts.require('DELTAToken');
const snapshot = require('../snapshot');
const { advanceTimeAndBlock } = require('../timeHelpers');
const constants = require('../constants');
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

    // Returns number n raised to the e'th power as a bignumber
    const nmBN = (n, m) => {
        return (new BN(n)).pow(new BN(m));
    }

    // Returns number n multiplied by 10 the the 18th power (ne18) as a bignumber
    const ne18BN = (n) => {
        return (new BN(n)).mul( nmBN(10, 18) );
    }

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

        const ape2deets = await deltaToken.totalsForWallet(ape2);
        ape2deets.maxBalance = (await deltaToken.userInformation(ape2)).maxBalance;

        await assert(ape2deets.maxBalance.eq(new BN(1200000)),"Max balanace mismatch");
        await assert(new BN(ape2deets.total).eq(new BN(1200000)),"Totals mismatch");
        await assert((await deltaToken.balanceOf(ape2)).lt(new BN(1200000)),"Totals mismatch");

        // We mature completely
        await advanceByHours(480);   
        await assert((await deltaToken.balanceOf(ape2)).eq(new BN(1200000)),"Totals mismatch");


      console.log("======\nbuckets loaded\n========\n\n")
      await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)

      // 85624 is average gas without isolating this.
      await deltaToken.gasTestTransfer('0xdafce5670d3f67da9a3a44fe6bc36992e5e2beab', '1200000', {from: ape2});
      console.log('sent!');
      await printAllTransactionBucketsAndRevertIfOneOfThemIsntImmatureZero(deltaToken,ape2)  


    })

    const balanceShouldBe = async (deltaToken, amount, person) => {
      const balance = await deltaToken.balanceOf(person)
      await assert(balance.toString()=== amount, `Person does not have enough balance expected ${amount} got ${balance.toString()}`);
      return balance
    }

    const setupDeltaToken = async () => {
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


});
