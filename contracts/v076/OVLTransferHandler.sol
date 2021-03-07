// SPDX-License-Identifier: MIT
pragma experimental ABIEncoderV2;
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol"; 
import "@openzeppelin/contracts/utils/Address.sol";
import "./OVLTokenTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDELTA_DISTRIBUTOR {
    function creditUser(address,uint256) external;
}


contract OVLTransferHandler {
    using SafeMath for uint256;
    using SafeMath for uint112;
    using Address for address;
    event Transfer(address indexed from, address indexed to, uint256 value);


    // shared state begin v0
    uint256 private _gap;
    mapping (address => UserInformation) public userInformation;
    uint256 private __gap;
    mapping (address => VestingTransaction[QTY_EPOCHS]) public vestingTransactions;
    
    uint256 private ___gap;
    mapping (address => uint256) private _maxPossibleBalances;
    uint256 private ____gap;
    mapping (address => mapping (address => uint256)) private _allowances;
    uint256 private _totalSupply;

    address public distributor;
    uint256 public lpTokensInPair;
    address constant private uniswapRouterv2 = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public immutable uniswapDELTAxWETHPair;
    // Handles vesting


    //// WARNIGN
    // THIS CAN NEVER CHANGE EVEN ON UPGRADES
    uint8 public constant QTY_EPOCHS = 7; // seven transation buckets
    uint256 [72] private ____bigGap;

    // shared state end of v0
    uint256 public constant SECONDS_PER_EPOCH = 172800; // About 2days

    constructor() {
        uniswapDELTAxWETHPair = address(0x1);
    }


    function getTransactionDetail(VestingTransaction memory _tx) public view returns (VestingTransactionDetailed memory dtx) {
        dtx = _getTransactionDetail(_tx, block.timestamp);
    }
    function _getTransactionDetail(VestingTransaction memory _tx, uint256 _blockTimestamp) public view returns (VestingTransactionDetailed memory dtx) {
        if(_tx.fullVestingTimestamp == 0) {
            return dtx;
        }
        dtx.amount = _tx.amount;
        dtx.fullVestingTimestamp = _tx.fullVestingTimestamp;
        // at precision E4, 1000 is 10%
        uint256 timeRemaining;
        if(_blockTimestamp >= dtx.fullVestingTimestamp) {
            // Fully vested
            timeRemaining = 0;
        }
        else {
            timeRemaining = dtx.fullVestingTimestamp - _blockTimestamp;
        }

        uint256 percentWaitingToVestE4 = timeRemaining.mul(1e4).div(SECONDS_PER_EPOCH * QTY_EPOCHS);
        uint256 percentWaitingToVestE4Scaled = percentWaitingToVestE4.mul(90).div(100);

        dtx.immature = uint112(_tx.amount.mul(percentWaitingToVestE4Scaled).div(1e4));
        dtx.mature = uint112(_tx.amount.sub(dtx.immature));
    }

    function calculateTransactionDebit(VestingTransactionDetailed memory dtx, uint256 matureAmountNeeded, uint256 currentTimestamp) public pure returns (uint256 outputDebit) {
        if(dtx.fullVestingTimestamp > currentTimestamp) {
            // Only a partially vested transaction needs an output debit to occur
            // Precision Multiplier -- this many zeros (23) seems to get all the precision needed for all 18 decimals to be only off by a max of 1 unit
            uint256 pm = 1e23;

            // This will be between 0 and 100*pm representing how much of the mature pool is needed
            uint256 percentageOfMatureCoinsConsumed = matureAmountNeeded.mul(pm).div(dtx.mature);
            require(percentageOfMatureCoinsConsumed<=pm, "OVLTransferHandler: Insufficient funds");

            // Calculate the number of immature coins that need to be debited based on this ratio
            outputDebit = dtx.immature.mul(percentageOfMatureCoinsConsumed).div(pm);
        }
        require(dtx.amount <= dtx.mature.add(dtx.immature), "DELTAToken: Balance maximum problem"); // Just in case
    }


    function _removeBalanceFromSender(address sender, bool immatureRecieverWhiteslited, uint112 amount) internal returns (uint112 totalRemoved) {
        UserInformation memory senderInfoMemory = userInformation[sender];

        // We check if recipent can get immature tokens, if so we go from the most imature first to be most fair to the user
        if(immatureRecieverWhiteslited) {

            //////
            ////
            // we go from the least mature balance to the msot mature meaning --
            ////
            /////

            uint256 accBal;

            while(true) {
                VestingTransaction memory leastMatureTx = vestingTransactions[sender][senderInfoMemory.lastInTxIndex];
                uint256 remainingBalanceNeeded = amount.sub(accBal);

                if(leastMatureTx.amount >= remainingBalanceNeeded) {
                    // We got enough in this bucket to cover the amount
                    // We remove it from total and dont adjust the fully vesting timestamp
                    // Because there might be tokens left still in it
                    totalRemoved += uint112(remainingBalanceNeeded);
                    vestingTransactions[sender][senderInfoMemory.lastInTxIndex].amount = leastMatureTx.amount - uint112(remainingBalanceNeeded); // safe math already checked
                    // We got what we wanted we leave the loop
                    break;
                } else {
                                  
                    //we add the whole amount of this bucket to the accumulated balance
                    accBal = accBal.add(leastMatureTx.amount);

                    totalRemoved += leastMatureTx.amount;

                    vestingTransactions[sender][senderInfoMemory.lastInTxIndex].amount = 0;
                    vestingTransactions[sender][senderInfoMemory.lastInTxIndex].fullVestingTimestamp = 0;

                    // And go to the more mature tx
                    if(senderInfoMemory.lastInTxIndex == 0) {
                        senderInfoMemory.lastInTxIndex = QTY_EPOCHS;
                    }
                    
                    senderInfoMemory.lastInTxIndex--;

                    // If we can't get enough in this tx and this is the last one, then we bail
                    if(senderInfoMemory.lastInTxIndex == senderInfoMemory.mostMatureTxIndex) {
                        // If we still have enough to cover in the mature balance we use that
                        uint256 maturedBalanceNeeded = amount.sub(accBal);
                        // Exhaustive underflow check
                    
                        userInformation[sender].maturedBalance = uint112(userInformation[sender].maturedBalance.sub(maturedBalanceNeeded, "OVLTransferHandler: Insufficient funds"));
                        totalRemoved += uint112(maturedBalanceNeeded);

                        break;
                    }

                }
            }
             // We write to storage the lastTx Index, which was in memory and we looped over it (or not)
            userInformation[sender].lastInTxIndex = senderInfoMemory.lastInTxIndex;
            return totalRemoved; 

            // End of logic in case reciever is whitelisted ( return assures)
        }

        //////
        ////
        // we go from the most mature balance up
        ////
        /////


        if(senderInfoMemory.maturedBalance >= amount) {
            userInformation[sender].maturedBalance = senderInfoMemory.maturedBalance - amount; // safemath safe
            totalRemoved = amount;
        } 
        else {
            // Possibly using a partially vested transaction
            uint256 accBal = senderInfoMemory.maturedBalance;
            totalRemoved = senderInfoMemory.maturedBalance;
            // Use the entire balance to start
            userInformation[sender].maturedBalance = 0;


            while(amount > accBal) {
                VestingTransaction memory mostMatureTx = vestingTransactions[sender][senderInfoMemory.mostMatureTxIndex];
                uint256 remainingBalanceNeeded = amount.sub(accBal);

                // Reduce this transaction as the final one
                VestingTransactionDetailed memory dtx = getTransactionDetail(mostMatureTx);
                // credit is how much i got from this bucket
                // So if i didnt get enough from this bucket here we zero it and move to the next one
                if(remainingBalanceNeeded >= dtx.mature) {
                    totalRemoved += dtx.amount;
                    accBal = accBal.add(dtx.mature);
                    vestingTransactions[sender][senderInfoMemory.mostMatureTxIndex].amount = 0;
                    vestingTransactions[sender][senderInfoMemory.mostMatureTxIndex].fullVestingTimestamp = 0; // refund gas
                } else {
                    // Rmove the only needed amount
                    // Calculating debt based on the actual clamped credit eliminates
                    // the need for debit/credit ratio checks we initially had.
                    // Big gas savings using this one weird trick. Vitalik HATES it.
                    uint256 outputDebit = calculateTransactionDebit(dtx, remainingBalanceNeeded, block.timestamp);
                    uint256 totalRemovedThisBucket = outputDebit.add(remainingBalanceNeeded);
                    totalRemoved += uint112(totalRemovedThisBucket);

                    // We dont need to adjust timestamp
                    vestingTransactions[sender][senderInfoMemory.mostMatureTxIndex].amount = uint112(vestingTransactions[sender][senderInfoMemory.mostMatureTxIndex].amount.sub(totalRemovedThisBucket, "Removing too much from bucket"));
                    break;
                }

                // If we just went throught he lasttx bucket, and we did not get enough then we bail
                /// Note if its the lastTransaction it already had a break;
                if(senderInfoMemory.mostMatureTxIndex == senderInfoMemory.lastInTxIndex && accBal != amount) { // accBal != amount because of the case its exactly equal with first if
                    // Avoid ever looping around a second time because that would be bad
                    revert("OVLTransferHandler: Insufficient funds");
                }

                // We just emptied this so most mature one must be the next one
                senderInfoMemory.mostMatureTxIndex++;
                if(senderInfoMemory.mostMatureTxIndex == QTY_EPOCHS) {
                    senderInfoMemory.mostMatureTxIndex = 0;
                }
            }
            
            // We remove the entire amount removed 
            // We already added amount
            userInformation[sender].mostMatureTxIndex = senderInfoMemory.mostMatureTxIndex;
        }
    }



    function updateLPBalanceOfPair(address ethPairAddress) internal {
        uint256 newLPSupply = IERC20(ethPairAddress).balanceOf(ethPairAddress);
        require(newLPSupply >= lpTokensInPair, "DELTAToken: Liquidity removals are forbidden");
        // We allow people to bump the number of LP tokens inside the pair, but we dont allow them to go lower
        // Making liquidity withdrawals impossible
        // Because uniswap queries banaceOf before doing a burn, that means we can detect a inflow of LP tokens
        // But someone could send them and then reset with this function
        // This is why we "lock" the bigger amount here and dont allow a lower amount than the last time
        // Making it impossible to anyone who sent the liquidity tokens to the pair (which is nessesary to burn) not be able to burn them
        lpTokensInPair = newLPSupply;
    }


    function _transferTokensToRecipient(address recipient, UserInformation memory senderInfo, UserInformation memory recipientInfo, uint112 amount) internal  {
        // If the sender can send fully or this recipent is whitelisted to not get vesting we just add it to matured balance

        if(senderInfo.fullSenderWhitelisted || recipientInfo.noVestingWhitelisted) {
            userInformation[recipient].maturedBalance = uint112(recipientInfo.maturedBalance.add(amount));
            return;
        }

        uint8 lastTransactionIndex = recipientInfo.lastInTxIndex;
        VestingTransaction memory lastTransaction = vestingTransactions[recipient][lastTransactionIndex];
  
        // Do i fit in this bucket?
        // conditions for fitting inside a bucket are
        // 1 ) Either its less than 2 days old
        // 2 ) Or its more than 14 days old
        // 3 ) Or we move to the next one - which is empty or already matured
        // Note that only the first bucket checked can logically be less than 2 days old, this is a important optimization
        // So lets take care of that case now, so its not checked in the loop.

        uint256 timestampNow = block.timestamp;

        if(timestampNow >= lastTransaction.fullVestingTimestamp) { // Its mature we move it to mature and override
            userInformation[recipient].maturedBalance = uint112(recipientInfo.maturedBalance.add(vestingTransactions[recipient][lastTransactionIndex].amount));
            vestingTransactions[recipient][lastTransactionIndex].amount = uint112(amount);
            vestingTransactions[recipient][lastTransactionIndex].fullVestingTimestamp = uint112(timestampNow + SECONDS_PER_EPOCH * QTY_EPOCHS);

        } else if (lastTransaction.fullVestingTimestamp >= timestampNow + SECONDS_PER_EPOCH * (QTY_EPOCHS - 1)) {// we add 12 days
            // we avoid overflows from 0 fullyvestedtimestamp
            // if fullyVestingTimestamp is bigger than that we should increment
            // but not bigger than fullyVesting
            // This check is exhaustive
            // If this is the case we just put it in this bucket.
            vestingTransactions[recipient][lastTransactionIndex].amount = uint112(vestingTransactions[recipient][lastTransactionIndex].amount.add(amount));
            /// No need to adjust timestamp`
        }
        else { // We move to the next one, which is always either 0 or matured

            lastTransactionIndex++; 
            if(lastTransactionIndex == QTY_EPOCHS) { lastTransactionIndex = 0; } // Loop over
            userInformation[recipient].lastInTxIndex = lastTransactionIndex;

            // To figure out if this is a empty bucket or a stale one
            // Its either the most mature one 
            // Or its 0
            // There is no other logical options
            // If this is the most mature one then we go > with most mature
            uint8 mostMature = recipientInfo.mostMatureTxIndex;
            if(mostMature == lastTransactionIndex) {
                // It was the most mature one, so we have to increment the most mature index
                mostMature++;
                if(mostMature == QTY_EPOCHS) { mostMature = 0; }
                userInformation[recipient].mostMatureTxIndex = mostMature;
            }

            // Other cases are, this is empty or this is stale
            // In each case we just override the amount
            // we add to totals of the user withotu checking what it is, bnecause its either 0 or fully mature doesnt matter.
            userInformation[recipient].maturedBalance = uint112(recipientInfo.maturedBalance.add(vestingTransactions[recipient][lastTransactionIndex].amount));
            vestingTransactions[recipient][lastTransactionIndex].amount = uint112(amount);
            vestingTransactions[recipient][lastTransactionIndex].fullVestingTimestamp = uint112(timestampNow + SECONDS_PER_EPOCH * QTY_EPOCHS);

        }
    }


    function handleTransfer(address sender, address recipient, uint256 amount, address ethPairAddress) external {
            require(sender != recipient, "DELTAToken: Can not send DELTA to yourself");
            require(sender != address(0), "ERC20: transfer from the zero address"); 
            require(recipient != address(0), "ERC20: transfer to the zero address");
            require(amount < uint112(-1), "DELTAToken: Input corrupt");
            // We cast to 112
            uint112 amount112 = uint112(amount);
            
            /// Liquidity removal protection
            if(sender == ethPairAddress || recipient == ethPairAddress) {
                updateLPBalanceOfPair(ethPairAddress);
            }


            UserInformation memory senderInfo = userInformation[sender];
            UserInformation memory recipientInfo = userInformation[recipient];


            uint112 totalRemoved = _removeBalanceFromSender(sender, recipientInfo.immatureRecieverWhiteslited, amount112);
            uint112 toDistributor = uint112(totalRemoved.sub(amount112, "OVLTransferHandler: Insufficient funds"));
            // We remove from max balance totals

            userInformation[sender].maxBalance = uint112(userInformation[sender].maxBalance.sub(totalRemoved, "OVLTransferHandler: Insufficient funds"));

            // Sanity check
            require(totalRemoved >= amount112, "OVLTransferHandler: Insufficient funds");
            // Max is 90% of total removed
            require(amount112.mul(9) >= toDistributor, "DELTAToken: Burned too many tokens"); 

            _creditDistributor(sender,toDistributor);
            //////
            /// We add tokens to the recipient
            //////
            _transferTokensToRecipient(recipient, senderInfo, recipientInfo, amount112);
            // We add to total balance for sanity checks and uniswap router
            userInformation[recipient].maxBalance = uint112(userInformation[recipient].maxBalance.add(amount112));

            emit Transfer(sender, recipient, uint256(amount112));
    }

    function _creditDistributor(address creditedBy, uint112 amount) internal {
        address _distributor = distributor; // gas savings for storage reads
        userInformation[_distributor].maturedBalance = uint112(userInformation[_distributor].maturedBalance.add(amount)); // Should trigger an event here
        IDELTA_DISTRIBUTOR(_distributor).creditUser(creditedBy, uint256(amount));
        emit Transfer(creditedBy, _distributor, uint256(amount));
    }

}