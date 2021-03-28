const { assert } = require("hardhat");
const { getLatestBlock } = require("./fork");

/**
 * Register a transfer at a given epoch and return an array that needs to be
 * reused in this method to add new transfers so it can calculate the current
 * balance with getVestedBalance
 * 
 * First epoch is 0, max is 6
 */
const addDeltaTransfer = (day, amount, vestingInfo = { maturedAmount: 0, transfers: [] }) => {
  const epoch = parseInt((day % 14) / 2);
  assert(epoch >= 0 && epoch < 7);

  // Support full matured balance
  if (vestingInfo.transfers[epoch] && day - vestingInfo.transfers[epoch].day >= 14) {
    vestingInfo.maturedAmount = vestingInfo.maturedAmount + vestingInfo.transfers[epoch].amount;
    vestingInfo.transfers[epoch] = undefined;
  }

  if (!vestingInfo.transfers[epoch]) {
    vestingInfo.transfers[epoch] = {
      day,
      amount,
    };
  } else {
    vestingInfo.transfers[epoch].amount = amount + vestingInfo.transfers[epoch].amount;
  }

  return vestingInfo;
};

/**
 * For all the transfers that happenned at each epoch
 * calculate what it's worth for the current vesting epoch. 
 */
const getDeltaVestedBalance = (day, vestingInfo) => {
  assert(vestingInfo.transfers.length <= 7);
  let totalBalanceAtThisEpoch = 0;

  const transfers = vestingInfo.transfers;
  // Loop through all the transfers and calculate the vesting
  for (let epoch = 0; epoch < transfers.length; epoch++) {
    assert(transfers[epoch] !== undefined);

    // max amount when fully vested
    const maxAmount = transfers[epoch].amount;
    const dayStartVesting = transfers[epoch].day;

    // what's the current vested amount?
    const incrementPerEpochForThisVestingAmount = maxAmount / 14 * 0.9
    const initialAmount10Percent = maxAmount * 0.1;
    const transferCurrentVestingDay = day - dayStartVesting;

    // Get the current vested amount for the given day
    const currentVestedAmount = Math.min(initialAmount10Percent + (incrementPerEpochForThisVestingAmount * transferCurrentVestingDay), maxAmount);

    totalBalanceAtThisEpoch = totalBalanceAtThisEpoch + currentVestedAmount;
  }

  return totalBalanceAtThisEpoch + vestingInfo.maturedAmount;
};

const printAllTransactionBuckets = async (delta, account) => {
  let buckets = {};

  const timestamp = (await getLatestBlock()).timestamp;
  const balance = await delta.balanceOf(account);
  console.table([{
    timestamp,
    account,
    balance: `${balance} (${(balance.toString() / 1e18).toFixed(4)})`
  }]);

  for (let i = 0; i < 7; i++) {
    const transaction = await delta.vestingTransactions(account, i);
    const transactionDetails = await delta.getTransactionDetail([transaction.amount.toString(), transaction.fullVestingTimestamp.toString()]);

    buckets[i] = {
      mature: `${transactionDetails.mature.toString()} (${(transactionDetails.mature.toString() / 1e18).toFixed(4)})`,
      immature: `${transactionDetails.immature.toString()} (${(transactionDetails.immature.toString() / 1e18).toFixed(4)})`,
      amount: `${transactionDetails.amount.toString()} (${(transactionDetails.amount.toString() / 1e18).toFixed(4)})`,
      fullVestingTimestamp: `${transactionDetails.fullVestingTimestamp.toString()}`,
      secondsLeft: `${Math.max(0, transactionDetails.fullVestingTimestamp - timestamp)}`,
    };
  }
  console.table(buckets);
}

module.exports = {
  addDeltaTransfer,
  getDeltaVestedBalance,
  printAllTransactionBuckets
}