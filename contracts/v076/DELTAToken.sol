// SPDX-License-Identifier: MIT
// DELTA-BUG-BOUNTY
pragma experimental ABIEncoderV2;
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/GSN/Context.sol";
import "@openzeppelin/contracts/math/SafeMath.sol"; 
import "@openzeppelin/contracts/utils/Address.sol";
import "./OVLTokenTypes.sol";
import "./OVLTransferHandler.sol";
import "./OVLBalanceHandler.sol";
import "./preFirstRebasing/OVLLPRebasingHandler.sol";
import "./preFirstRebasing/OVLLPRebasingBalanceHandler.sol";

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
    function balanceOf(address) external returns (uint256);
}

interface IRebasingLiquidityToken {
    function rebase(uint256, uint256) external;
}

interface IOVLBalanceHandler {
    function handleBalanceCalculations(address, address) external pure returns (uint256);
}

// Implementation of the DELTA token responsible
// for the CORE ecosystem options layer
// guarding unlocked liquidity inside of the ecosystem
// This token is time lock guarded by 90% FoT which disappears after 2 weeks to 0%
// balanceOf will return the spendable amount outside of the fee on transfer.

contract DELTAToken is Context, IERC20 {
    using SafeMath for uint256;
    using SafeMath for uint112;
    using Address for address;

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

    bool public liquidityRebasingPermitted;
    address public governance;
    string private _name;
    string private _symbol;
    uint8 private _decimals;
    address public tokenTransferHandler;
    address constant public wethAddress = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IWETH constant public wETH = IWETH(wethAddress);
    uint112 TOTAL_INITIAL_SUPPLY = 45000000e18;
    address public rebasingLPAddress;
    address public tokenBalanceHandler;
    address public lswAddress;

    // Handler for activation after first rebasing
    address private tokenBalanceHandlerMain;
    address private tokenTransferHandlerMain;

    constructor (address _lswAddress, address rebasingLP,  address multisig) public {
        _name = "DELTA.financial - deep DeFi derivatives";
        _symbol = "DELTA";
        _decimals = 18;
        lswAddress = _lswAddress;
        require(address(this) < wethAddress, "DELTAToken: Invalid Token Address");

        // We get the pair address
        // token0 is the smaller address
        address uniswapPair = address(uint(keccak256(abi.encodePacked(
                hex'ff',
                0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f, // Mainnet uniswap factory
                keccak256(abi.encodePacked(address(this), wethAddress)),
                hex'96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f' // init code hash
            ))));
        // We whitelist the pair to have no vesting on reception
        governance = msg.sender; // TODO: Remove -- bypass !gov checks (Note that temporary test measures like this aren't valid bug bounty issues)
        setNoVestingWhitelist(uniswapPair, true);
        setWhitelists(multisig, true, true, true);

        setFullSenderWhitelist(lswAddress,true); // Nessesary for lsw because it doesnt just send to the pair

        governance = multisig;

        uniswapDELTAxWETHPair = uniswapPair;
        rebasingLPAddress = rebasingLP;
        _provide_initial_supply(lswAddress, TOTAL_INITIAL_SUPPLY); 

        // Set post first rebasing ones now into private variables
        tokenTransferHandlerMain = address(new OVLTransferHandler());
        tokenBalanceHandlerMain = address(new OVLBalanceHandler(tokenTransferHandlerMain, uniswapPair)); 
        
        //Set pre rebasing ones as main ones
        tokenBalanceHandler = address(new OVLLPRebasingBalanceHandler()); 
        tokenTransferHandler = address(new OVLLPRebasingHandler());

    }

    function activatePostFirstRebasingState() public {
        require(msg.sender == governance, "!gov");
        tokenTransferHandler = tokenTransferHandlerMain;
        tokenBalanceHandler = tokenBalanceHandlerMain;
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public view returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply.sub(balanceOf(0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF));
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(sender, _msgSender(), _allowances[sender][_msgSender()].sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].add(addedValue));
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].sub(subtractedValue, "ERC20: decreased allowance below zero"));
        return true;
    }

    function setFullSenderWhitelist(address account, bool canSendToMatureBalances) public {
        require(msg.sender == governance, "!gov");
        userInformation[account].fullSenderWhitelisted = canSendToMatureBalances;
    }

   function setImmatureRecipentWhitelist(address account, bool canRecieveImmatureBalances) public {
        require(msg.sender == governance, "!gov");
        userInformation[account].immatureRecieverWhiteslited = canRecieveImmatureBalances;
    }

    function setNoVestingWhitelist(address account, bool recievesBalancesWithoutVestingProcess) public {
        require(msg.sender == governance, "!gov"); 
        userInformation[account].noVestingWhitelisted = recievesBalancesWithoutVestingProcess;
    }

    function setWhitelists(address account, bool canSendToMatureBalances, bool canRecieveImmatureBalances, bool recievesBalancesWithoutVestingProcess) public  {
        require(msg.sender == governance, "!gov");
        userInformation[account].noVestingWhitelisted = recievesBalancesWithoutVestingProcess;
        userInformation[account].immatureRecieverWhiteslited = canRecieveImmatureBalances;
        userInformation[account].fullSenderWhitelisted = canSendToMatureBalances;
    }

    function changeRLPAddress(address newAddress) public {
        require(msg.sender == rebasingLPAddress, "DELTAToken: Only Rebasing LP contract can call this function");
        require(newAddress != address(0), "DELTAToken: Cannot set to 0 address");
        rebasingLPAddress = newAddress;
    }

    // Allows for liquidity rebasing atomically 
    // Does a callback to rlp and closes right after
    function allowLiquidityRebasing(uint256 loopCount, uint256 percentOfLP) public {
        require(msg.sender == rebasingLPAddress, "DELTAToken: Only Rebasing LP contract can call this function");
        liquidityRebasingPermitted = true;
        IRebasingLiquidityToken(rebasingLPAddress).rebase(loopCount,percentOfLP);
        liquidityRebasingPermitted = false;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal virtual {

        bytes memory callData = abi.encodeWithSignature("handleTransfer(address,address,uint256,address)", sender, recipient, amount, uniswapDELTAxWETHPair);
        (bool success, bytes memory result) = tokenTransferHandler.delegatecall(callData);

        if(success == false) {
            revert(_getRevertMsg(result));
        } 
    }
    
    function balanceOf(address account) public view override returns (uint256) {
        // function handleBalanceCalculations(address account, address sender) public view returns (uint256) {
        return IOVLBalanceHandler(tokenBalanceHandler).handleBalanceCalculations(account, msg.sender);
    }

    function getTransactionDetail(VestingTransaction memory _tx) public view returns (VestingTransactionDetailed memory dtx) {
       return IOVLTransferHandler(tokenTransferHandler).getTransactionDetail(_tx);
    }

    function _provide_initial_supply(address account, uint112 amount) internal virtual {
        require(account != address(0), "ERC20: supplying zero address");

        userInformation[account].maturedBalance = uint112(userInformation[account].maturedBalance.add(amount));
        userInformation[account].maxBalance = uint112(userInformation[account].maxBalance.add(amount));
        _totalSupply = _totalSupply.add(amount);

        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint112 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        userInformation[account].maturedBalance = uint112(userInformation[account].maturedBalance.sub(amount, "ERC20: burn amount exceeds balance"));
        userInformation[account].maxBalance = uint112(userInformation[account].maxBalance.sub(amount));
        _totalSupply = _totalSupply.sub(amount);

        emit Transfer(account, address(0), amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /// @notice sets a new distributor potentially with new distribution rules
    function setDistributor(address _newDistributor) public  {
        require(msg.sender == governance, "!gov");
        distributor = _newDistributor;
    }

    /// @notice sets the function that calculates returns from balanceOF
    function setBalanceCalculator(address _newBalanceCalculator) public {
        require(msg.sender == governance, "!gov");
        tokenBalanceHandler = _newBalanceCalculator;
    }

    /// @notice sets a contract with new logic for transfer handlers (contract upgrade)
    function setTokenTransferHandler(address _newHandler) public {
        require(msg.sender == governance, "!gov");
        tokenTransferHandler = _newHandler;
    }

    function _getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return 'Transaction reverted silently';

        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }


    function totalsForWallet(address account) public view returns (WalletTotals memory totals) {
        uint256 mature = userInformation[account].maturedBalance;
        uint256 immature;
        for(uint256 i = 0; i < QTY_EPOCHS; i++) {
            VestingTransactionDetailed memory dtx = getTransactionDetail(vestingTransactions[account][i]); 
            mature = mature.add(dtx.mature);
            immature = immature.add(dtx.immature);
        }
        totals.mature = mature;
        totals.immature = immature;
        totals.total = mature.add(immature);
    }

}
