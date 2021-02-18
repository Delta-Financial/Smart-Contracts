// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

contract DeltaMultiSigMock {
    function numberOfDelegatesNeeded(address, string memory)
        external
        view
        returns (uint256)
    {}

    function isActiveMultiSignator(address) external returns (bool) {}

    function execute(address, string memory, bytes memory)
        external
        returns (bytes memory)
    {}

    function multisignatorInfo(address)
        external
        view
        returns (
            uint256,
            address,
            bool
        )
    {}
}
