pragma solidity ^0.7.6;
// DELTA-BUG-BOUNTY

struct VestingTransaction {
    uint112 amount;
    uint112 fullVestingTimestamp;
}

struct WalletTotals {
    uint256 mature;
    uint256 immature;
    uint256 total;
}

struct UserInformation {
    // TODO move this into better structs? 
    // This is going to be read from only [0]
    uint8 mostMatureTxIndex;
    uint8 lastInTxIndex;
    uint112 maturedBalance;
    uint112 maxBalance;
    bool fullSenderWhitelisted;
    // Note that recieving immature balances doesnt mean they recieve them fully vested just that senders can do it
    bool immatureRecieverWhiteslited;
    bool noVestingWhitelisted;
}

struct VestingTransactionDetailed {
    uint112 amount;
    uint112 fullVestingTimestamp;
    // uint256 percentVestedE4;
    uint112 mature;
    uint112 immature;
}