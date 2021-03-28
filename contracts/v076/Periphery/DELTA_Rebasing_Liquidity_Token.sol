// SPDX-License-Identifier: UNLICENSED
import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; 
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import "@openzeppelin/contracts/utils/Address.sol"; 
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/IWETH.sol";
import "../../interfaces/IDELTA_TOKEN.sol";
import '../uniswapv2/libraries/UniswapV2Library.sol';

import 'hardhat/console.sol';

interface IDELTARouter {
    function openLiquidityAdditions() external;
}


interface IRESERVE_VAULT {
    function flashBorrowEvertyhing(uint256) external;
}


interface IDELTA_LSW {
    function totalWETHEarmarkedForReferrers() external view returns (uint256);
}

contract DELTA_Rebasing_Liquidity_Token is ERC20 ("Rebasing Liquidity Token - DELTA.financial", "DELTA rLP")  {
    using SafeMath for uint256;

    address public constant WETH_ADDRESS = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant LSW = 0xdaFCE5670d3F67da9A3A44FE6bc36992e5E2beaB;
    address public immutable RESERVE_VAULT;

    uint256 public nextRebase;

    IUniswapV2Pair public deltaxWethPair;
    IWETH immutable weth;
    IDELTA_TOKEN public delta;
    uint256 public initialRebasingLPTarget;
    bool public initialRebasingDone;
    uint256 public lpTokenReserves;

    address public migratedContract;
    address public lswAddress;
    uint private unlocked = 1;

    modifier lock() {
        require(unlocked == 1, 'DELTA_Rebasing_Liquidity_Token: LOCKED');
        unlocked = 0;
        _;
        unlocked = 1;
    }

    // Rebasing LP is created before DELTA TOKEN is.
    constructor (address _reserveVault) public {
        //LSW call points
        RESERVE_VAULT = _reserveVault;
        weth = IWETH(WETH_ADDRESS);
    }

    function onlyLSW() public view {
        require(msg.sender == LSW, "!LSW GO AWAY");
    }

    function setBaseLPToken(address _baseLPToken) public {
        onlyLSW();
        require(address(deltaxWethPair) == address(0), "Already set");
        deltaxWethPair = IUniswapV2Pair(_baseLPToken);
        delta = IDELTA_TOKEN(deltaxWethPair.token0());
    }

    function deltaGovernance() public view returns (address) {
        if(address(delta) == address(0)) {return address (0); }
        return IDELTA_TOKEN(address(delta)).governance();
    }

    function onlyMultisig() private view {
        require(msg.sender == deltaGovernance(), "!governance");
    }


    // @notice wraps all LP tokens of the caller, requires allowance
    // @dev intent of this function is to get the balance of the caller, and wrap his entire balance, update the basetoken supply, and issue the caller amount of tokens that we transfered from him
    function wrap() public {
        uint256 balanceCaller = deltaxWethPair.balanceOf(msg.sender);
        require(balanceCaller > 0, "No tokens to wrap");
        // @dev from caller , to here , amount total of caller
        bool success = deltaxWethPair.transferFrom(msg.sender, address(this), balanceCaller);
        require(success, "Transfer Failure");
        lpTokenReserves = lpTokenReserves.add(balanceCaller); // TODO: Review this. Are we not using reserves?
        mintRLP(msg.sender, balanceCaller);
    }


    function mintRLP(address to, uint256 amount) internal {
        skimLPToNewContract(); // If we migrated send the lp to the migrated one
        _mint(to, amount);
    }

    function balances(address person) internal view returns (uint256,uint256) {
        return (delta.balanceOf(address(person)), weth.balanceOf(address(person)));
    }

    // Test function only TODO make internal
    /// @param numberLoops how many loops of trade
    function addVolume(uint256 numberLoops) public {
        console.log("RLP :: addVolume()");
        // Have the delta token allow for burning of LP, temporarily.
        delta.allowLiquidityRebasing(numberLoops);  
    }

    // Delta token calls this after allowLiquidityRebasing is in the middle of execution on the token contract
    function tokenCallee(uint256 numberLoops) public {
        require(msg.sender == address(delta), "Not authorised, go away shoo shoo!");
        IRESERVE_VAULT(RESERVE_VAULT).flashBorrowEvertyhing(numberLoops);
    }

    function printBalanaces(uint256 token0, uint256 token1, string memory thing) public {
        console.log("== ", thing, " ==");   
        console.log("DELTA token0",token0);
        console.log("ETH token1",token1);
    }

    // The delta reserve calls this during execution in order to complete flash borrowing
    function reserveCallee(uint256 transferedDELTA, uint256 transferedWETH, uint256 numberLoops) public {
        // Not under review -- Trade secret
    }


    /// @notice opens the first rebasing
    function openRebasing() public {
        onlyLSW();
        // we check hwo much LP we have
        // This call only happens once so we can assume a lot here
        uint256 initialMintLP = deltaxWethPair.balanceOf(address(this));
        uint256 totalETHInLSW = (1500 ether + RESERVE_VAULT.balance + IDELTA_LSW(LSW).totalWETHEarmarkedForReferrers()) * 2;
        uint256 percentOfTotalInPair = uint256(1500 ether).mul(100).div(totalETHInLSW);
        initialRebasingLPTarget = initialMintLP.mul(percentOfTotalInPair).div(100);
    }


    function onlyNewContract() public view {
        require(msg.sender == migratedContract, 'Wrong sender');
    }

    /// @notice allows timelock-multisig contract to migrate tokens to a new contract
    function migrate(address newContract) public {
        require(Address.isContract(newContract), 'Address is not a contract');

        /// @dev we try to check if the team is calling, to migrate the functions to a new contract address
        /// If its not, we check if the new contract is calling
        if (msg.sender == deltaGovernance() ) {
            /// The intent of this is to disallow the admins to call this again and instead have it callled explicit from new cotnract only
            require(migratedContract == address(0), "Already migrated");
            _migrate(newContract);
        }
        else {
            onlyNewContract();
            /// Intended behaviour is a throw here and non migration in case its not a contract or team calling
            _migrate(newContract);
        }
    }

    function intiialRebase() public {
        require(initialRebasingDone == false, "initial rebasing is alreayd done");
        _rebase();
        initialRebasingDone = initialRebasingLPTarget >= deltaxWethPair.balanceOf(address(this));
    }


    function rebase() public {
        require(initialRebasingDone, "initial rebasing has not started yet");
        uint256 _nextRebase = nextRebase;
        require(block.timestamp >= _nextRebase, "DELTA RLP : Rebase time pending");
        require(_nextRebase > 0, "DELTA RLP : Rebasing not open yet");
        _rebase();
        nextRebase = _nextRebase.add(24 hours);
    }

    function _rebase() internal {
        require(msg.sender == tx.origin, "Smart contract calls are disallowed");
        // Not under review -- Trade secret
    }

    /// @dev sends all LP tokens to the new contract, to utilize in rewards or similar
    function _migrate(address toWhere) internal {
        deltaxWethPair.transfer(toWhere, deltaxWethPair.balanceOf(address(this)));
        migratedContract = toWhere;
    }

    function skimLPToNewContract() public {
        if(migratedContract != address(0)) {
            deltaxWethPair.transfer(migratedContract, deltaxWethPair.balanceOf(address(this)));
        }
    }

}


