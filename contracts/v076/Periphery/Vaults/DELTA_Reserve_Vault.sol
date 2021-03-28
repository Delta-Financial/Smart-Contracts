// SPDX-License-Identifier: UNLICENSED
// DELTA-BUG-BOUNTY
pragma solidity ^0.7.6;

import "../../libs/SafeMath.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import "../../../interfaces/IDELTA_TOKEN.sol";
import "../../../interfaces/IRebasingLiquidityToken.sol";

interface INEW_RESERVE_VAULT {
    function initializeMigration(uint256) external;
}


contract DELTA_Reserve_Vault {
    using SafeMath for uint256;

    IDELTA_TOKEN public delta;
    IERC20 constant public WETH = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    uint256  public DELTA_PER_ONE_WHOLE_ETH;
    address constant public DELTA_LSW = 0xdaFCE5670d3F67da9A3A44FE6bc36992e5E2beaB;
    address private immutable INTERIM_OWNER;
    address public rlp;
    bool private lock;
    bool public floorExchangeOpen;


    modifier locked {
        require(lock == false,"Locked");
        lock = true;
        _;
        lock = false;
    }

    receive() external payable {
        revert("ETH not allowed");
    }

    constructor() public {
        INTERIM_OWNER = msg.sender;
    }

    function setupDeltaToken(address __deltaToken) public {
        require(address(delta) == address(0), "Delta token already set");
        require(msg.sender == INTERIM_OWNER || msg.sender == deltaGovernance(), "!authorised");
        delta = IDELTA_TOKEN(__deltaToken);
    }

    function setupRLP(address _rlp) public {
        require(rlp == address(0), "Delta token already set");
        onlyMultisig();
        rlp = _rlp;
    }

    function flashBorrowEvertyhing(uint256 numberLoops) public locked {
        require(msg.sender != address(0));
        require(msg.sender == rlp);
        uint256 balanceDELTA = delta.balanceOf(address(this));
        uint256 balanceWETH = WETH.balanceOf(address(this));

        delta.transfer(rlp,balanceDELTA);
        WETH.transfer(rlp,balanceWETH);

        IRebasingLiquidityToken(rlp).reserveCallee(balanceDELTA,balanceWETH,numberLoops);

        require(delta.balanceOf(address(this)) == balanceDELTA, "Did not get DELTA back");
        require(WETH.balanceOf(address(this)) == balanceWETH, "Did not get WETH back");
    }

    function openFloorExchange(bool open) public {
        onlyMultisig();
        floorExchangeOpen = open;
    }


    function setRatio(uint256 ratio) public {
        require(msg.sender == DELTA_LSW,"");
        DELTA_PER_ONE_WHOLE_ETH = ratio;
    }

    function exchangeDELTAForFloorPrice(uint256 _amount) public {
        require(floorExchangeOpen, "!open");
        require(delta.transferFrom(msg.sender, address(this), _amount), "Transfer poo poo, likely no allowance");
        uint256 ethDue = _amount.mul(1e18).div(DELTA_PER_ONE_WHOLE_ETH);
        WETH.transfer(msg.sender, ethDue);
    }

    function migrateToNewReserveVault(address newReserveVault) public {
        onlyMultisig();
        WETH.transfer(newReserveVault, WETH.balanceOf(address(this)));
        delta.transfer(newReserveVault, delta.balanceOf(address(this)));
        INEW_RESERVE_VAULT(newReserveVault).initializeMigration(DELTA_PER_ONE_WHOLE_ETH);
    }


    function deltaGovernance() public view returns (address) {
        if(address(delta) == address(0)) {return address (0); }
        return delta.governance();
    }

    function onlyMultisig() private view {
        require(msg.sender == deltaGovernance(), "!governance");
    }




}