// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

contract DeltaMultiSigMock {
    function numberOfDelegatesNeeded(address, string memory)
        external
        view
        returns (uint256)
    {}

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
