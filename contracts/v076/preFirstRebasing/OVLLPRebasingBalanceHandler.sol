// DELTA-BUG-BOUNTY
pragma abicoder v2;
pragma solidity ^0.7.6;

import "../../interfaces/IDELTA_TOKEN.sol";
import "../../interfaces/IOVLBalanceHandler.sol";

import "../../common/OVLTokenTypes.sol";
import 'hardhat/console.sol';


contract OVLLPRebasingBalanceHandler is IOVLBalanceHandler {
    IDELTA_TOKEN private immutable DELTA_TOKEN;

    constructor() {
        DELTA_TOKEN = IDELTA_TOKEN(msg.sender);
    }

    function handleBalanceCalculations(address account, address) external view override returns (uint256) {
        UserInformationLite memory ui = DELTA_TOKEN.getUserInfo(account);
        console.log("handleBalanceCalculations returns", ui.maxBalance);

        return ui.maxBalance;
    }
}