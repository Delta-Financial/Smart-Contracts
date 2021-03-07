import "../OVLTokenTypes.sol";
// DELTA-BUG-BOUNTY

pragma abicoder v2;


interface IDELTA_TOKEN {
    function userInformation(address) external view returns (UserInformation memory);
}


contract OVLLPRebasingBalanceHandler {

    IDELTA_TOKEN immutable DELTA_TOKEN;

    constructor() public {
        DELTA_TOKEN = IDELTA_TOKEN(msg.sender);
    }

    function handleBalanceCalculations(address account, address sender) public view returns (uint256) {
        return DELTA_TOKEN.userInformation(account).maxBalance;
    }
}