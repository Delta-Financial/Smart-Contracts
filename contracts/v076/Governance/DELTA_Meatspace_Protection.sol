pragma solidity ^0.7.6;

// They will come for you
// I know
// But it won't matter

contract MeatSpaceProtection {

    // stop gap contract
    // That returns true for everything until its changed
    // Meant to be used as a canary

    function hasVotingRights(address person) public pure returns (bool) {
        return true;
    }


    
}