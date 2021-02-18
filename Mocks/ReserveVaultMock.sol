// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

contract ReserveVaultMock {
    uint256  public DELTA_PER_ONE_WHOLE_ETH;

    constructor() public {}

    function setRatio(uint256 ratio) public {
        DELTA_PER_ONE_WHOLE_ETH = ratio;
    }

    function exchangeDELTAForFloorPrice(uint256 _amount) public {}

    function migrateToNewReserveVault(address newReserveVault) public {}
}
