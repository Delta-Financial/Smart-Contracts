const { expect, artifacts, assert } = require("hardhat");
const { constants, expectRevert } = require("@openzeppelin/test-helpers");
const { smockit } = require("@eth-optimism/smock");
const { mainnet } = require("../config");
const { resertFork, impersonate, getLatestBlock, timesDecimals, setNextBlockTimestamp, getDeltaVestedBalance, addDeltaTransfer } = require("../utils");
const { BN } = require("@openzeppelin/test-helpers/src/setup");
const expectEvent = require("@openzeppelin/test-helpers/src/expectEvent");
const { takeSnapshot, revertToSnapshot } = require("../snapshot");
const { advanceTimeAndBlock } = require("../timeHelpers");
const balance = require("@openzeppelin/test-helpers/src/balance");
const { ensureFile } = require("fs-extra");

const RebasingLiquidityTokenMock = artifacts.require("RebasingLiquidityTokenMock");
const OVLTransferHandler = artifacts.require("OVLTransferHandler");
const DeltaToken = artifacts.require("DELTAToken");
const Distributor = artifacts.require('DELTA_Distributor');

const requireBlockNumber = 11672829;
const secondsInADay = 24 * 60 * 60;
const secondsInHour = 60 * 60;

const ape1 = web3.utils.toChecksumAddress('0x4e9b45b1b16dd4ddb76cf9564563edf2d1ebc41e');
const ape2 = web3.utils.toChecksumAddress('0x5c9fe745f8bb40755eb9fcf8b4fb9d2691618c5e');
const ape3 = web3.utils.toChecksumAddress('0x92fc9ac5baa4abace91f7d7b7f2fe9cf4848c36e');
const ape4 = web3.utils.toChecksumAddress('0x078fe9f57c3419e256851986ecf4c1132a661356');
const ape5 = web3.utils.toChecksumAddress('0x0e37b805ce08d27585981c86c2b9f96c6e53bd1d');
const revert = web3.utils.toChecksumAddress('0xd5b47b80668840e7164c1d1d81af8a9d9727b421');

let delta;
let totalSupply;

const aroundIsh = async (amount, expectedAmount) => {
  const precisionBounds = (number, precision) => {
    return {
      upper: number.mul(precision).div(precision.sub(1)),
      lower: number.mul(precision).div(precision.add(1))
    }
  }
  amount = new BN(amount);
  expectedAmount = precisionBounds(new BN(expectedAmount));

  await assert(amount.gte(expectedAmount.lower), "Amount is too small");
  await assert(amount.lte(expectedAmount.upper), "amount is too large");
};

const expectAdvanceOneDayAndVestedAmount = async (account, vestingDay, minAmount, maxAmount, toleratedImprecision = 0.001) => {
  verbose = true;

  verbose && console.log('~~~ vestingDay', vestingDay, 'minAmount', (minAmount.toString() / 1e18).toLocaleString(), 'maxAmount', (maxAmount.toString() / 1e18).toLocaleString());
  verbose && console.log('   - Current amount at day', vestingDay, 'is:', (await delta.balanceOf(account)) / 1e18);

  minAmount = new BN(minAmount);
  maxAmount = new BN(maxAmount);
  vestingDay = new BN(vestingDay);

  const amountAddedEachDay = maxAmount.sub(minAmount).div(new BN('14'));
  verbose && console.log('   - Amount added each day:', amountAddedEachDay.toString() / 1e18);

  const timestamp = (await getLatestBlock()).timestamp;
  const oneDay = 1 * secondsInADay;

  verbose && console.log('   - Advancing 24h...');
  await advanceTimeAndBlock(oneDay);
  expect(((await getLatestBlock()).timestamp) - timestamp).to.be.gte(oneDay);

  // if (vestingDay >= 14) {
  //   expect(await delta.balanceOf(account)).to.be.bignumber.equal(maxAmount);
  //   return;
  // }

  let expectedAmount = minAmount.add(vestingDay.mul(amountAddedEachDay));
  verbose && console.log('   - Expected amount is:', expectedAmount.toString() / 1e18);

  if (expectedAmount.gt(maxAmount)) {
    verbose && console.log('expectedAmount.gt(maxAmount)');
    expectedAmount = maxAmount;
  }

  const currentBalance = (await delta.balanceOf(account)).toString() / 1e18;
  verbose && console.log('   - Current amount is:', currentBalance);
  const difference = (expectedAmount.toString() / 1e18) - currentBalance;

  verbose && console.log('difference', difference);

  // allow 0.09% imprecision
  expect(difference).to.be.lt(0.0009);
};

const expectAdvanceOneHourAndVestedAmount = async (account, vestingHour, minAmount, maxAmount, toleratedImprecision = 0.005) => {
  verbose = false;

  verbose && console.log('~~~ vestingHour', vestingHour, 'minAmount', (minAmount.toString() / 1e18).toLocaleString(), 'maxAmount', (maxAmount.toString() / 1e18).toLocaleString());
  verbose && console.log('   - Current amount at hour', vestingHour, 'is:', (await delta.balanceOf(account)) / 1e18);

  minAmount = new BN(minAmount);
  maxAmount = new BN(maxAmount);
  vestingHour = new BN(vestingHour);

  const amountAddedEachHour = maxAmount.sub(minAmount).div(new BN('336')); // 336 = 14 * 24h
  verbose && console.log('   - Amount added each hours:', amountAddedEachHour.toString() / 1e18);

  const timestamp = (await getLatestBlock()).timestamp;
  const oneHour = 1 * secondsInHour;

  verbose && console.log('   - Advancing 1h...');
  await advanceTimeAndBlock(oneHour);
  expect(((await getLatestBlock()).timestamp) - timestamp).to.be.gte(oneHour);

  if (vestingHour >= 14 * 24) {
    expect(await delta.balanceOf(account)).to.be.bignumber.equal(maxAmount);
    return;
  }

  let expectedAmount = minAmount.add(vestingHour.mul(amountAddedEachHour));
  verbose && console.log('   - Expected amount is:', expectedAmount.toString() / 1e18);

  if (expectedAmount.gt(maxAmount)) {
    expectedAmount = maxAmount;
  }

  const currentBalance = await delta.balanceOf(account);
  verbose && console.log('   - Current amount is:', currentBalance.toString() / 1e18);
  const difference = expectedAmount.sub(currentBalance);

  // 0.055% imprecision tolerance.
  const epsilon = toleratedImprecision;

  if (expectedAmount.gt(new BN('0'))) {
    const differentPercent = Math.abs(parseFloat(difference.toString()) / parseFloat(expectedAmount.toString()));
    //console.log('current vs expected', currentBalance.toString(), expectedAmount.toString());
    expect(differentPercent).to.be.lte(epsilon);
  } else {
    expect(await delta.balanceOf(account)).to.be.bignumber.equal(expectedAmount);
  }
};


const expectBalanceNowAndFullyVestedAtEachHour = async (account, minAmount, maxAmount, toleratedImprecision) => {
  expect(await delta.balanceOf(account)).to.be.bignumber.equal(minAmount);

  const snapshot = await takeSnapshot();

  const totalHoursIn14Days = 14 * 24;
  for (let i = 0; i < totalHoursIn14Days; i++) {
    const hour = i + 1;
    console.log('Hour', `${hour}/${totalHoursIn14Days}`);
    await expectAdvanceOneHourAndVestedAmount(account, i + 1, minAmount, maxAmount, toleratedImprecision);
  }

  expect(await delta.balanceOf(account)).to.be.bignumber.equal(maxAmount.toString());
  await revertToSnapshot(snapshot);
};

const expectBalanceNowAndFullyVested = async (account, minAmount, maxAmount, toleratedImprecision = 0.001) => {
  minAmount = new BN(minAmount);
  maxAmount = new BN(maxAmount);

  const snapshot = await takeSnapshot();

  // Do no use loops as it helps knowing where a failure comes when the expection fails.
  await expectAdvanceOneDayAndVestedAmount(account, 1, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 2, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 3, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 4, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 5, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 6, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 7, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 8, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 9, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 10, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 11, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 12, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 13, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 14, minAmount, maxAmount, toleratedImprecision);
  await expectAdvanceOneDayAndVestedAmount(account, 15, minAmount, maxAmount, toleratedImprecision);

  // expect(await delta.balanceOf(account)).to.be.bignumber.equal(maxAmount.toString());
  await revertToSnapshot(snapshot);
};

const advanceByHours = async (hours) => {
  await advanceTimeAndBlock(60 * 60 * hours)
};

const reset = async () => {
  await resertFork(requireBlockNumber);
  await impersonate(mainnet.addresses.coreMultisig);

  const rebasingTokenMock = await RebasingLiquidityTokenMock.new();
  delta = await DeltaToken.new(mainnet.addresses.coreMultisig, rebasingTokenMock.address, mainnet.addresses.coreMultisig, { from: mainnet.addresses.coreMultisig });
  distributor = await Distributor.new(delta.address, constants.ZERO_ADDRESS, { from: mainnet.addresses.coreMultisig });
  delta.setDistributor(distributor.address, { from: mainnet.addresses.coreMultisig });

  // Skip LP rebasing phase
  await delta.activatePostFirstRebasingState({ from: mainnet.addresses.coreMultisig });

  expect(delta.address).to.not.be.equal(constants.ZERO_ADDRESS);
  expect(await delta.name()).to.be.equal('DELTA.financial - deep DeFi derivatives');
  expect(await delta.symbol()).to.be.equal('DELTA');
  expect(await delta.decimals()).to.be.bignumber.equal('18');
  expect(await delta.rebasingLPAddress()).to.be.equal(rebasingTokenMock.address);

  totalSupply = await delta.totalSupply();
  expect(await delta.totalSupply()).to.be.bignumber.equal('45000000000000000000000000');
  expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal(totalSupply);
  expect(await delta.balanceOf(delta.address)).to.be.bignumber.equal('0');
};

describe("delta / token", async () => {
  beforeEach(async () => {
    await reset();
  });

  describe("transfer", async () => {
    xit('shouldnt allow sending of dust you dont have if you are sending to noVesting', async () => {
      await delta.setNoVestingWhitelist(ape2, true, { from: mainnet.addresses.coreMultisig });
      await expectRevert(
        delta.transfer(ape2, '480000000000000000', { from: ape1 }),  // 0.48 tokens
        "OVLTransferHandler: Insufficient funds");
    });

    xit('shouldnt allow sending of more than you have if you are noVesting', async () => {
      await delta.setNoVestingWhitelist(ape2, true, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '1000000', { from: mainnet.addresses.coreMultisig });

      await expectRevert(
        delta.transfer(ape1, '9000000', { from: ape2 }),
        "OVLTransferHandler: Insufficient funds");
    });

    /*xit('shouldnt be off by 1', async () => {

      await delta.transfer(ape1, '14000', { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '1400', { from: ape1 });
      await advanceTimeAndBlock(172800) // 2 days
      await delta.transfer(ape2, '500', { from: ape1 });
      await advanceTimeAndBlock(172800) // 2 days
      const expectedBalance = new BN(
        // b(A,D) = mature balance of a transaction
        // A = amount
        // D = days since sent
        1400 * (1 / 10 + 9 * 4 / 140) +
        500 * (1 / 10 + 9 * 2 / 140)
      );
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal(expectedBalance);
    });*/

    /**
     * 1. coreMultisig sends 1.23456789 to ape1, ape1 balance is 0.123456789 as owner is not FullSenderWhitelist
     * 2. coreMultisig is now setFullSenderWhitelist
     * 3. coreMultisig sends 1.23456789 to ape2, ape2 balance is 1.23456789
     * 4. coreMultisig sends 0.98754321 to ape2, ape2 balance is 2.2221111 (1.23456789 + 0.98754321)
     * 5. ape2 sends 1.23456789 to ape3, ape3 balance is 0.123456789, ape2 balance is 0.9875432099999999 (2.2221111 - 1.23456789)
     * 6. ape3 sends 0.123456789 to ape2, ape3 balance is 0, ape2 balance is 1.110999999 (0.9875432099999999 + 0.123456789)
     * 
     * At step 6, ape2 balance is 0.9998888889 instead of 1.110999999.
     * Difference is 
     */
    xit('should only be able to send all tokens even if there are immature one', async () => {
      await delta.transfer(ape1, '1234567890000000000', { from: mainnet.addresses.coreMultisig });

      // since multisig is full sender whitelisted, ape1 will receive all the tokens as matured.
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('1234567890000000000');

      await delta.setFullSenderWhitelist(mainnet.addresses.coreMultisig, true, { from: mainnet.addresses.coreMultisig });
      expect((await delta.userInformation(mainnet.addresses.coreMultisig)).fullSenderWhitelisted).to.be.true;

      await delta.transfer(ape2, '1234567890000000000', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('1234567890000000000');

      await delta.transfer(ape2, '987543210000000000', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('2222111100000000000');

      await delta.transfer(ape3, '1234567890000000000', { from: ape2 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('123456789000000000');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('987543210000000000');

      await delta.transfer(ape2, '123456789000000000', { from: ape3 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('123456789000001');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('999888888900000000');
    });

    xit('should only be able to send all tokens even if there are immature one', async () => {
      await delta.transfer(ape1, '123456789', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('123456789');

      await delta.setFullSenderWhitelist(mainnet.addresses.coreMultisig, true, { from: mainnet.addresses.coreMultisig });
      expect((await delta.userInformation(mainnet.addresses.coreMultisig)).fullSenderWhitelisted).to.be.true;
      await delta.transfer(ape2, '123456789', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('123456789');
      await delta.transfer(ape2, '98754321', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('222211110');
      await delta.transfer(ape2, '10000000000', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('10222211110');


      await delta.transfer(ape3, '1234567890', { from: ape2 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('123456789');


      await delta.transfer(ape2, '123456789', { from: ape3 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('123458');

      // ape2 should have 222211110 - 123456789 + 12345678
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('8999988899');
    });

    xit('should not fail with DELTAToken: Burned too much tokens 1/2', async () => {
      await delta.transfer(ape1, '10', { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '10', { from: ape1 });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('1');
      await delta.transfer(ape3, '1', { from: ape2 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('1');
    });

    /*xit('should not fail with DELTAToken: Burned too much tokens 2/2', async () => {
      await delta.transfer(ape1, '119', { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '119', { from: ape1 });
      await delta.transfer(ape3, '11', { from: ape2 });
    });*/

    xit('should not accumulate dusts 1/3', async () => {
      await delta.transfer(ape1, '10', { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '10', { from: ape1 });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('1');
      await advanceByHours(9999999999);
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('10');
      await delta.transfer(ape3, '10', { from: ape2 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('1');
      await advanceByHours(9999999999);
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('10');
    });

    xit('should not accumulate dusts 2/3', async () => {
      await delta.transfer(ape1, '1', { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, '1', { from: ape1 });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('1');
      await advanceByHours(9999999999);
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('1');
      await delta.transfer(ape3, '1', { from: ape2 });
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('1');
      await advanceByHours(9999999999);
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('1');
    });

    xit('should revert when the vested balance is insufficient', async () => {
      await delta.transfer(ape1, '1000', { from: mainnet.addresses.coreMultisig });
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('1000');
      await delta.transfer(ape2, '1000', { from: ape1 });
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('100');
      await expectRevert(delta.transfer(ape3, '102', { from: ape2 }), 'OVLTransferHandler: Insufficient funds');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('101');
      expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('0');
    });

    xit('should keep a reasonnable vesting precision hourly 1/2', async () => {
      const amount = new BN(timesDecimals(1234));
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');

      await delta.transfer(ape1, amount, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, amount, { from: ape1 });
      await expectBalanceNowAndFullyVestedAtEachHour(ape2, amount.mul(new BN('10')).div(new BN('100')), amount);
    });

    xit('should keep a reasonnable vesting precision daily 1/2', async () => {
      const amount = new BN(timesDecimals(1234));
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');

      await delta.transfer(ape1, amount, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, amount, { from: ape1 });
      await expectBalanceNowAndFullyVested(ape2, amount.mul(new BN('10')).div(new BN('100')), amount);
    });


  const printAllTransactionBuckets = async (deltaToken, person)=> {

        let buckets = {};
        
        for(var i=0;i<7;i++) {
            const transaction = await deltaToken.vestingTransactions(person, i);
            const transactionDetails = await deltaToken.getTransactionDetail([transaction.amount.toString(), transaction.fullVestingTimestamp.toString()]);
     
            buckets[i] = {mature : humanRadable(new BN(transactionDetails.mature)),
               immature:humanRadable(new BN(transactionDetails.immature)),
                amount:humanRadable(new BN(transactionDetails.amount)), 
                fullVestingTimestamp:humanRadable(new BN(transactionDetails.fullVestingTimestamp)) };
          } 
          console.table(buckets);
      }



    xit('should keep a reasonnable vesting precision daily 2/2', async () => {
      /// 225,000 tokens
      const amount = totalSupply.mul(new BN('5')).div(new BN('1000'));
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal(totalSupply);

      await delta.transfer(ape1, amount, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape2, amount, { from: ape1 });

      const startingAmount = amount.mul(new BN('10')).div(new BN('100'));
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal(startingAmount);
      await expectBalanceNowAndFullyVested(ape2, startingAmount, amount);
    });

    xit('should have the right balance when multiple transfers occured accross multiple epochs', async () => {
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal(totalSupply);

      // Each entry is 1 day but 2 days are getting aggregated into 1 epoch.
      // So for example if I transfer 324+2 at day 1 and then 3324 at day 2
      // they are going to be in the same epoch and the later transfer (3324) will
      // use the same maturation as the previous one.
      //
      // In other words, at day 1 the balance is going to be 32.6 (10% of 324) and at day 2
      // when it transfers 3324 additionnal delta it will be as if it has been 326+3324 at day 1
      // so at day 2 it should be:
      // (326+3324)*0.1 + (326+3324)/14*0.9 = 599.6428
      const days = [
        // Epoch 0
        { transfers: [timesDecimals(324), timesDecimals(2)], balance: '32600000000000000000' },
        { transfers: [timesDecimals(3324)], balance: '599330000000000000000' },

        // Epoch 1
        { transfers: [timesDecimals(34)], balance: '837425000000000000000' },
        { transfers: [timesDecimals(1224), timesDecimals(22), timesDecimals(12), timesDecimals(1)], balance: '1280665600000000000000' },

        // Epoch 2
        { transfers: [timesDecimals(24)], balance: '1601265500000000000000' },
        { transfers: [timesDecimals(11)], balance: '1921953100000000000000' },

        // Epoch 3
        { transfers: [timesDecimals(3)], balance: '2242467800000000000000' },
        { transfers: [timesDecimals(1)], balance: '2563142200000000000000' },

        // Epoch 4
        { transfers: [timesDecimals(9), timesDecimals(54)], balance: '2889423300000000000000' },
        { transfers: [timesDecimals(89)], balance: '3228549700000000000000' },

        // Epoch 5
        { transfers: [timesDecimals(78)], balance: '3566337000000000000000' },
        { transfers: [timesDecimals(37)], balance: '3907524100000000000000' },

        // Epoch 6
        { transfers: [timesDecimals(358)], balance: '4280481500000000000000' },
        { transfers: [timesDecimals(224), timesDecimals(112), timesDecimals(87)], balance: '4710771100000000000000' },

        // <epoch reset>
        // Epoch 0
        { transfers: [timesDecimals(38)], balance: '5102181900000000000000' },
        { transfers: [timesDecimals(22)], balance: '5261322800000000000000' },

        // Epoch 1
        { transfers: [timesDecimals(58)], balance: '5424074200000000000000' },
        { transfers: [timesDecimals(2)], balance: '5501805700000000000000' },

        // no more transfers, validate remaining maturing
        // Epoch 2
        { transfers: [], balance: '5579413400000000000000' },
        { transfers: [], balance: '5654839100000000000000' },

        // Epoch 3
        { transfers: [], balance: '5730111800000000000000' },
        { transfers: [], balance: '5805214200000000000000' },

        // Epoch 4
        { transfers: [], balance: '5880236200000000000000' },
        { transfers: [], balance: '5945649100000000000000' },

        // Epoch 5
        { transfers: [], balance: '6010899300000000000000' },
        { transfers: [], balance: '6068839600000000000000' },

        // Epoch 6
        { transfers: [], balance: '6126840000000000000000' },
        { transfers: [], balance: '6134562000000000000000' },

        // Epoch 0
        { transfers: [], balance: '6142278000000000000000' },
        { transfers: [], balance: '6146136000000000000000' },

        // Epoch 1
        { transfers: [], balance: '6150000000000000000000' },
        { transfers: [], balance: '6150000000000000000000' },

        // Epoch 2
        { transfers: [], balance: '6150000000000000000000' },
        { transfers: [], balance: '6150000000000000000000' },

        // Epoch 3
        { transfers: [], balance: '6150000000000000000000' },
        { transfers: [], balance: '6150000000000000000000' },

        // Epoch 4
        { transfers: [], balance: '6150000000000000000000' },
        { transfers: [], balance: '6150000000000000000000' },
      ];

      /**
       * Holds all transfers for one account
       */
      let vestingInfo;

      /**
       * This loop each epoches defined above with each epochs containing transfers
       */
      let prevEpoch = -1;
      for (let i = 0; i < days.length; i++) {
        const day = i;
        const transfers = days[i].transfers;
        const expectedBalance = days[i].balance;
        const epoch = parseInt(i / 2) % 7;

        if (prevEpoch !== epoch) {
          console.log('==== Epoch', epoch, '====');
          prevEpoch = epoch;
        }

        /**
         * Do the transfers for this epoch
         */
        for (let j = 0; j < transfers.length; j++) {
          const amount = transfers[j];
          // Transfer from core multi sig since he has the tokens, when sending them they are not vested
          await delta.transfer(ape2, amount, { from: mainnet.addresses.coreMultisig });
          expect(await delta.balanceOf(ape2)).to.be.bignumber.equal(amount);
          await delta.transfer(ape1, amount, { from: ape2 });

          // Register this new transfer to calculate the total wallet vesting amount later.
          vestingInfo = addDeltaTransfer(day, amount.toString() / 1e18, vestingInfo);
        }

        const balance = await delta.balanceOf(ape1);
        const balanceFloat = balance.toString() / 1e18;
        const calculatedExpectedAmount = getDeltaVestedBalance(day, vestingInfo);
        const diff = (new BN(expectedBalance)).sub(balance).abs();
        const imprecision = (balanceFloat - calculatedExpectedAmount) / balanceFloat;

        console.log(
          'day:', day,
          'balance:', balance.toString(), balance.toString() / 1e18,
          //'expected:', /*expectedBalance.toString(),*/ expectedBalance.toString() / 1e18,
          'expectedFromCalculation:', calculatedExpectedAmount,
          //'difference:', diff.toString(), diff.toString() / 1e18,
          'percent difference from calculation', `${((balanceFloat - calculatedExpectedAmount) / balanceFloat * 100).toFixed(2)}%`
        );

        // DELTA token results depends on the current timestamp and hardhat is imprecise when
        // advancing time so we need to compare with an epsilon.
        expect(imprecision).to.be.lt(0.001);

        await advanceTimeAndBlock(1 * secondsInADay);
      }
    });

    it('should not fail', async () => {
      const amount = '123000000000000000000';
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal(totalSupply);
      await delta.transfer(ape5, amount, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape1, amount, { from: ape5 });
      console.log("Got first transfer of",humanRadable(new BN('123000000000000000000')))
      await printAllTransactionBuckets(delta, ape1)

      // await expectBalanceNowAndFullyVested(ape1, '12300000000000000000', '123000000000000000000');

      await delta.transfer(ape2, '12300000000000000000', { from: ape1 })
      console.log("Sent out", humanRadable(new BN('12300000000000000000')) )
      await printAllTransactionBuckets(delta, ape1)

      // await expectBalanceNowAndFullyVested(ape2, '1230000000000000000', '12300000000000000000');

      await delta.transfer(ape3, '1230000000000000000', { from: ape2 });
      // await expectBalanceNowAndFullyVested(ape3, '123000000000000000', '1230000000000000000');

      await delta.transfer(ape4, '123000000000000000', { from: ape3 });
      // await expectBalanceNowAndFullyVested(ape4, '12300000000000000', '123000000000000000');


      await printAllTransactionBuckets(delta, ape1)
      await delta.transfer(ape1, '12300000000000000', { from: ape4 });
      await printAllTransactionBuckets(delta,ape1)
      await advanceByHours(48)
      await printAllTransactionBuckets(delta,ape1)
      await advanceByHours(999)
      await printAllTransactionBuckets(delta,ape1)
      await expectBalanceNowAndFullyVested(ape1, '1230000000000000', '12300000000000000');
    });


            function numberWithCommas(x) {
          return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    } 

    function BNwithCommas(x) {
      return numberWithCommas(x.toString());
    }


    const humanRadable = (bn) => {
      return `${BNwithCommas(bn)} (${BNwithCommas( bn.div( new BN(10).pow(new BN(18)) ))})`
    }


    it('should remove 90% each transfer', async () => {
      const amount = '123000000000000000000';
      expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('0');
      expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal(totalSupply);
      await delta.transfer(ape5, amount, { from: mainnet.addresses.coreMultisig });
      await delta.transfer(ape1, amount, { from: ape5 });

      const logStep = () => {
        process.stdout.write(".");
      };

      logStep();
      // ape5 123e18-> ape1
      await expectBalanceNowAndFullyVested(ape1, '12300000000000000000', '123000000000000000000');

      logStep();
      // ape1 123e17 -> ape2
      await delta.transfer(ape2, '12300000000000000000', { from: ape1 })
      logStep();
      await expectBalanceNowAndFullyVested(ape2, '1230000000000000000', '12300000000000000000');
      logStep();
      // ape2 123e16 -> ape3
      await delta.transfer(ape3, '1230000000000000000', { from: ape2 });
      logStep();
      await expectBalanceNowAndFullyVested(ape3, '123000000000000000', '1230000000000000000');
      logStep();
      // ape3 123e15 -> ape4
      await delta.transfer(ape4, '123000000000000000', { from: ape3 });
      logStep();
      await expectBalanceNowAndFullyVested(ape4, '12300000000000000', '123000000000000000');
      logStep();
      // ape4 -> 123e14 -> ape1
      await delta.transfer(ape1, '12300000000000000', { from: ape4 });
      logStep();
      await expectBalanceNowAndFullyVested(ape1, '1230000000000000', '12300000000000000');
      logStep();
      // ape1 -> 123e13 -> ape2
      await delta.transfer(ape2, '1230000000000000', { from: ape1 });
      logStep();
      await expectBalanceNowAndFullyVested(ape2, '123000000000000', '1230000000000000');
      logStep();
      // ape2 -> 123e12 -> ape3
      await delta.transfer(ape3, '123000000000000', { from: ape2 });
      logStep();
      await expectBalanceNowAndFullyVested(ape3, '12300000000000', '123000000000000');
      logStep();
      // ape3 -> 123e11 -> ape4
      await delta.transfer(ape4, '12300000000000', { from: ape3 });
      logStep();
      await expectBalanceNowAndFullyVested(ape4, '1230000000000', '12300000000000');
      logStep();
      // ape4 -> 123e10 -> ape1
      await delta.transfer(ape1, '1230000000000', { from: ape4 });
      logStep();
      await expectBalanceNowAndFullyVested(ape1, '123000000000', '1230000000000');
      logStep();
      // ape1 -> 123e9 -> ape2
      await delta.transfer(ape2, '123000000000', { from: ape1 });
      logStep();
      await expectBalanceNowAndFullyVested(ape2, '12300000000', '123000000000');
      logStep();
      // ape2 -> 123e8 -> ape3
      await delta.transfer(ape3, '12300000000', { from: ape2 });
      logStep();
      await expectBalanceNowAndFullyVested(ape3, '1230000000', '12300000000');
      logStep();
      // ape3 -> 123e7 -> ape4
      await delta.transfer(ape4, '1230000000', { from: ape3 });
      logStep();
      await expectBalanceNowAndFullyVested(ape4, '123000000', '1230000000');
      logStep();
      // ape4 -> 123e6 -> ape1
      await delta.transfer(ape1, '123000000', { from: ape4 });
      logStep();
      await expectBalanceNowAndFullyVested(ape1, '12300000', '123000000');
      logStep();
      // ape1 -> 123e5 -> ape2
      await delta.transfer(ape2, '12300000', { from: ape1 });
      logStep();
      await expectBalanceNowAndFullyVested(ape2, '1230000', '12300000');
      logStep();
      // ape2 -> 123e4 -> ape3
      await delta.transfer(ape3, '1230000', { from: ape2 });
      logStep();
      await expectBalanceNowAndFullyVested(ape3, '123000', '1230000');
      logStep();
      // ape3 -> 123e3 -> ape4
      await delta.transfer(ape4, '123000', { from: ape3 });
      logStep();
      await expectBalanceNowAndFullyVested(ape4, '12300', '123000');
      logStep();
      // ape4 -> 123e2 -> ape1
      await delta.transfer(ape1, '12300', { from: ape4 });
      logStep();

      /**
       * With dust the token become more and more imprecise.
       */
      await expectBalanceNowAndFullyVested(ape1, '1230', '12300', 0.01);
      logStep();
      // ape1 -> 123e1 -> ape2
      await delta.transfer(ape2, '1230', { from: ape1 });
      await expectBalanceNowAndFullyVested(ape1, '0', '0', 0.01);
      logStep();
      await expectBalanceNowAndFullyVested(ape2, '123', '1230', 0.01);
      logStep();
      // ape2 -> 123 -> ape3
      await delta.transfer(ape3, '123', { from: ape2 });
      await expectBalanceNowAndFullyVested(ape2, '0', '0', 0.01);
      logStep();
      await expectBalanceNowAndFullyVested(ape3, '12', '123', 0.5);
      logStep();
      // ape3 -> 12 -> ape4
      await delta.transfer(ape4, '12', { from: ape3 });
      await expectBalanceNowAndFullyVested(ape3, '0', '0', 0.5);
      logStep();
      await expectBalanceNowAndFullyVested(ape4, '1', '12', 0.5);
      logStep();
      // ape4 -> 1 -> ape1
      await delta.transfer(ape1, '1', { from: ape4 });
      await expectBalanceNowAndFullyVested(ape4, '0', '0', 0.5);
      logStep();
      await expectBalanceNowAndFullyVested(ape1, '0', '1', 0.5);
      logStep();

      expect(await delta.totalSupply()).to.be.bignumber.equal(totalSupply);
      // expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal('99877000000000000000000');

      // Advance 30 days
      await advanceByHours(30 * 24);
      // expect(await delta.balanceOf(ape1)).to.be.bignumber.equal('1');
      // expect(await delta.balanceOf(ape2)).to.be.bignumber.equal('0');
      // expect(await delta.balanceOf(ape3)).to.be.bignumber.equal('0');
      // expect(await delta.balanceOf(ape4)).to.be.bignumber.equal('0');

      expect(await delta.totalSupply()).to.be.bignumber.equal(totalSupply);
      // expect(await delta.balanceOf(mainnet.addresses.coreMultisig)).to.be.bignumber.equal('99877000000000000000000');
    });
  })
});
