// SPDX-License-Identifier: UNLICENSED
// DELTA-BUG-BOUNTY
pragma solidity ^0.7.6;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "../libs/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import '../uniswapv2/libraries/UniswapV2Library.sol';
import '../uniswapv2/libraries/Math.sol'; /// TODO This is nto used
import "../../interfaces/IDELTA_TOKEN.sol";

interface IDELTA_DEEP_FARMING_VAULT {
    function depositFor(address, uint256, uint256) external;
}

interface IREBASING_LIQUDIDITY_TOKEN {
    function balanceOf(address account) external view returns (uint256);
    function wrap() external;
    function approve(address spender, uint value) external returns (bool);
}

/**
 * @dev This contract be be whitelisted as noVesting since it can receive delta token
 * when swapping half of the eth when providing liquidity with eth only.
 */
contract DeltaRouter {
    using SafeMath for uint256;

    IWETH constant public WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    IDELTA_TOKEN public immutable DELTA_TOKEN;
    address public immutable deltaWethPair;

    bool public disabled;
    IDELTA_DEEP_FARMING_VAULT public immutable deepFarmingVault;
    IREBASING_LIQUDIDITY_TOKEN public immutable rebasingToken;

    constructor(address _deltaToken, address _deltaWethPair, address _deepFarmingVault, address _rebasingToken) public {
        require(_deltaToken != address(0), "Invalid DELTA_TOKEN Address");
        require(_deltaWethPair != address(0), "Invalid DeltaWethPair Address");
        require(_deepFarmingVault != address(0), "Invalid DeepFarmingVault Address");
        require(_rebasingToken != address(0), "Invalid RebasingToken Address");

        DELTA_TOKEN = IDELTA_TOKEN(_deltaToken);
        deltaWethPair = _deltaWethPair;
        deepFarmingVault = IDELTA_DEEP_FARMING_VAULT(_deepFarmingVault);
        rebasingToken = IREBASING_LIQUDIDITY_TOKEN(_rebasingToken);

        IUniswapV2Pair(_deltaWethPair).approve(address(_rebasingToken), uint(-1));
        IREBASING_LIQUDIDITY_TOKEN(_rebasingToken).approve(address(_deepFarmingVault), uint(-1));
    }
    
    function deltaGovernance() public view returns (address) {
        return DELTA_TOKEN.governance();
    }

    function onlyMultisig() private view {
        require(msg.sender == deltaGovernance(), "!governance");
    }

    function refreshApproval() public {
        IUniswapV2Pair(deltaWethPair).approve(address(rebasingToken), uint(-1));
        rebasingToken.approve(address(deepFarmingVault), uint(-1));
    }

    function disable() public {
        onlyMultisig();
        disabled = true;
    }

    function rescueTokens(address token) public {
        onlyMultisig();
        IERC20(token).transfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }
    
    function rescueEth() public {
        onlyMultisig();
        msg.sender.transfer(address(this).balance);
    }

    receive() external payable {
       revert("DeltaRouter: INVALID_OPERATION");
    }

    /// @notice Add liquidity using ETH only with a minimum lp amount to receive
    /// getLPTokenPerEthUnit() can be used to estimate the number of
    /// lp take can be minted from an ETH amount
    function addLiquidityETHOnly(uint256 _minLpOut, bool _autoStake) public payable {
        require(!disabled, 'DeltaRouter: DISABLED');

        uint256 buyAmount = msg.value.div(2);
        WETH.deposit{value: msg.value}();

        (uint256 reserveDelta, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 outDelta = UniswapV2Library.getAmountOut(buyAmount, wethReserve, reserveDelta);

        WETH.transfer(deltaWethPair, buyAmount);
        IUniswapV2Pair(deltaWethPair).swap(outDelta, 0, address(this), "");
        _addLiquidity(outDelta, buyAmount, reserveDelta, wethReserve, _minLpOut, _autoStake);
    }

    function addLiquidityBothSides(uint256 _deltaAmount, uint256 _minLpOut, bool _autoStake) public payable {
        require(!disabled, 'DeltaRouter: DISABLED');
        
        uint256 wethAmount = msg.value;
        WETH.deposit{value: msg.value}();
        
        bool success = IERC20(address(DELTA_TOKEN)).transferFrom(msg.sender, address(this), _deltaAmount);
        require(success, "DeltaRouter: TRANSFER_FAILED");

        (uint256 deltaReserve, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        _addLiquidity(_deltaAmount, wethAmount, deltaReserve, wethReserve, _minLpOut, _autoStake);
    }

    function _addLiquidity(uint256 _deltaAmount, uint256 _wethAmount, uint256 _deltaReserve, uint256 _wethReserve, uint256 _minLpOut, bool _autoStake) internal {
        uint256 optimalDeltaAmount = UniswapV2Library.quote(_wethAmount, _wethReserve, _deltaReserve);
        uint256 optimalWETHAmount = _wethAmount;

        if (optimalDeltaAmount > _deltaAmount) {
            optimalWETHAmount = UniswapV2Library.quote(_deltaAmount, _deltaReserve, _wethReserve);
            optimalDeltaAmount = _deltaAmount;
        }

        assert(WETH.transfer(deltaWethPair, optimalWETHAmount));
        assert(IERC20(DELTA_TOKEN).transfer(deltaWethPair, optimalDeltaAmount));
        
        IUniswapV2Pair(deltaWethPair).mint(address(this));
        require(IUniswapV2Pair(deltaWethPair).balanceOf(address(this)) >= _minLpOut, "DeltaRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        rebasingToken.wrap();

        if (_autoStake) {
            deepFarmingVault.depositFor(msg.sender, rebasingToken.balanceOf(address(this)), 0);
        } else {
            IERC20(address(rebasingToken)).transfer(msg.sender, rebasingToken.balanceOf(address(this)));
        }

        /// @dev refund dust
        /// Only do this when the dust to refund is more than 0.01 ETH since the transfer is expensive
        if (_deltaAmount > optimalDeltaAmount && _deltaAmount.sub(optimalDeltaAmount) > 10000000000000000) {
            uint256 deltaRefundAmount = IERC20(address(DELTA_TOKEN)).balanceOf(address(this));
            require(deltaRefundAmount <= _deltaAmount.div(100), "DeltaRouter: REFUND_EXCEED_MAX_ALLOWED");
            
            IERC20(address(DELTA_TOKEN)).transfer(msg.sender, _deltaAmount.sub(optimalDeltaAmount));
        }
        if (_wethAmount > optimalWETHAmount && _wethAmount.sub(optimalWETHAmount) > 10000000000000000) {
            uint256 withdrawAmount = _wethAmount.sub(optimalWETHAmount);
            WETH.transfer(msg.sender, IERC20(address(WETH)).balanceOf(address(this)));
        }
    }

    function getOptimalDeltaAmountForEthAmount(uint256 _ethAmount) public view returns (uint256 optimalDeltaAmount) {
        (uint256 deltaReserve, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        optimalDeltaAmount = UniswapV2Library.quote(_ethAmount, wethReserve, deltaReserve);
    }

    function getOptimalEthAmountForDeltaAmount(uint256 _deltaAmount) public view returns (uint256 optimalEthAmount) {
        (uint256 deltaReserve, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        optimalEthAmount = UniswapV2Library.quote(_deltaAmount, deltaReserve, wethReserve);
    }

    function getLPTokenPerEthUnit(uint256 _ethAmount) public view returns (uint256 liquidity) {
        (uint256 reserveDelta, uint256 reserveWeth, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 halfEthAmount = _ethAmount.div(2);
        uint256 outDelta = UniswapV2Library.getAmountOut(halfEthAmount, reserveWeth, reserveDelta);
        uint256 totalSupply = IUniswapV2Pair(deltaWethPair).totalSupply();
    

        uint256 optimalDeltaAmount = UniswapV2Library.quote(halfEthAmount, reserveWeth, reserveDelta);
        uint256 optimalWETHAmount = halfEthAmount;

        if (optimalDeltaAmount > outDelta) {
            optimalWETHAmount = UniswapV2Library.quote(outDelta, reserveDelta, reserveWeth);
            optimalDeltaAmount = outDelta;
        }
        
        reserveDelta -= optimalDeltaAmount;
        reserveWeth += optimalWETHAmount;

        liquidity = Math.min(optimalDeltaAmount.mul(totalSupply) / reserveDelta, optimalWETHAmount.mul(totalSupply) / reserveWeth);
    }

    function getLPTokenPerBothSideUnits(uint256 _deltaAmount, uint256 _ethAmount) public view returns (uint256 liquidity) {
        (uint256 reserveDelta, uint256 reserveWeth, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 totalSupply = IUniswapV2Pair(deltaWethPair).totalSupply();

        uint256 optimalDeltaAmount = UniswapV2Library.quote(_ethAmount, reserveWeth, reserveDelta);
        uint256 optimalWETHAmount = _ethAmount;

        if (optimalDeltaAmount > _deltaAmount) {
            optimalWETHAmount = UniswapV2Library.quote(_deltaAmount, reserveDelta, reserveWeth);
            optimalDeltaAmount = _deltaAmount;
        }

        liquidity = Math.min(optimalDeltaAmount.mul(totalSupply) / reserveDelta, optimalWETHAmount.mul(totalSupply) / reserveWeth);
    }
}
