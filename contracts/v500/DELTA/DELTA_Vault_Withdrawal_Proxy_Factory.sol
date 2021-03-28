// SPDX-License-Identifier: UNLICENSED
// DELTA-BUG-BOUNTY
pragma solidity ^0.5.3;

import "./DELTA_Vault_Withdrawal_Proxy.sol";

contract ProxyFactory {

    function createProxy(address masterCopy)
        public
        returns (address proxy)
    {
        proxy = address(new Proxy(masterCopy));
       
    }


}