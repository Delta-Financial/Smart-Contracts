pragma solidity ^0.7.6;

interface IDELTA_DISTRIBUTOR {
    function creditUser(address,uint256) external;
    function addDevested(address, uint256) external;
}