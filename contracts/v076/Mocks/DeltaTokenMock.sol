// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DeltaTokenMock is ERC20, Ownable {
    using SafeMath for uint256;
    uint256 constant MAX_SUPPLY = 45_000_000e18;

    constructor() public ERC20("Delta Token", "DELTA") {
        _mint(_msgSender(), MAX_SUPPLY);
    }

    function setFullSenderWhitelist(address account, bool canSendToMatureBalances) public onlyOwner {}

    function setImmatureRecipentWhitelist(address account, bool canRecieveImmatureBalances) public onlyOwner {}

    function setNoVestingWhitelist(address account, bool recievesBalancesWithoutVestingProcess) public onlyOwner {}
}
