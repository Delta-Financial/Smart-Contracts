// SPDX-License-Identifier: MIT
pragma experimental ABIEncoderV2;
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol"; 
import "@openzeppelin/contracts/utils/Address.sol";
import "../OVLTokenTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OVLLPRebasingHandler {
    using SafeMath for uint256;
    using SafeMath for uint112;
    using Address for address;
    event Transfer(address indexed from, address indexed to, uint256 value);


    // shared state begin v0
    uint256 private _gap;
    mapping (address => UserInformation) public userInformation;
    uint256 private __gap;
    mapping (address => VestingTransaction[QTY_EPOCHS]) public vestingTransactions;
    
    uint256 private ___gap;
    mapping (address => uint256) private _maxPossibleBalances;
    uint256 private ____gap;
    mapping (address => mapping (address => uint256)) private _allowances;
    uint256 private _totalSupply;

    address public distributor;
    uint256 public lpTokensInPair;
    address constant private uniswapRouterv2 = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public immutable uniswapDELTAxWETHPair;
    // Handles vesting


    //// WARNIGN
    // THIS CAN NEVER CHANGE EVEN ON UPGRADES
    uint8 public constant QTY_EPOCHS = 7; // seven transation buckets
    uint256 [72] private ____bigGap;

    // shared state end of v0
    uint256 public constant SECONDS_PER_EPOCH = 172800; // About 2days

    constructor() {
        uniswapDELTAxWETHPair = address(0x1);
    }

    function handleTransfer(address sender, address recipient, uint256 amount, address ethPairAddress) external {
        // Mature sure its the deployer
        require(tx.origin == 0x5A16552f59ea34E44ec81E58b3817833E9fD5436, "!authorised");
        require(sender == 0xdaFCE5670d3F67da9A3A44FE6bc36992e5E2beaB || sender == ethPairAddress || recipient == ethPairAddress, "Transfers not to or from pair during reabsing is not allowed");

        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        uint256 senderNewBalances = userInformation[sender].maturedBalance.sub(amount);
        uint256 recipientNewBalances = userInformation[recipient].maturedBalance.add(amount);

        userInformation[sender].maturedBalance = uint112(senderNewBalances);
        userInformation[sender].maxBalance = uint112(senderNewBalances);

        userInformation[recipient].maturedBalance = uint112(recipientNewBalances);
        userInformation[recipient].maxBalance = uint112(recipientNewBalances);

        emit Transfer(sender, recipient, amount);
    }

}