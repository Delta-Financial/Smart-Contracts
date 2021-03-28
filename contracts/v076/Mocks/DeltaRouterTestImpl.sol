// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "../libs/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import '../uniswapv2/libraries/UniswapV2Library.sol';
// import '../../uniswapv2/libraries/Math.sol'; /// TODO This is nto used

interface IUniswapV2Library {

}

import "hardhat/console.sol";

interface IDELTA_DEEP_FARMING_VAULT {
    function depositFor(address, uint256, uint256) external;
}

interface IREBASING_LIQUDIDITY_TOKEN {
    function balanceOf(address account) external view returns (uint256);
    function wrap() external;
}

contract DeltaRouterTestImpl is Ownable {
    using SafeMath for uint256;

    IWETH constant public WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    address public deltaToken;
    address public immutable deltaWethPair;
    IREBASING_LIQUDIDITY_TOKEN public rebasingToken;

    constructor(address _deltaToken, address _deltaWethPair, address _rebasingToken) public {
        require(_deltaToken != address(0), "Invalid DeltaToken Address");
        require(_deltaWethPair != address(0), "Invalid DeltaWethPair Address");
        require(_rebasingToken != address(0), "Invalid RebasingToken Address");

        deltaToken = _deltaToken;
        deltaWethPair = _deltaWethPair;
        rebasingToken = IREBASING_LIQUDIDITY_TOKEN(_rebasingToken);

        IUniswapV2Pair(_deltaWethPair).approve(address(rebasingToken), uint(-1));
    }

    function refreshApproval() public {
        IUniswapV2Pair(deltaWethPair).approve(address(rebasingToken), uint(-1));
    }

    function rescueTokens(address token) public onlyOwner {
        IERC20(token).transfer(msg.sender,IERC20(token).balanceOf(address(this)));
    }
    
    function rescueEth() public onlyOwner {
        msg.sender.transfer(address(this).balance);
    }

    receive() external payable {
       revert("DeltaRouter: INVALID_OPERATION");
    }

    function mintLpFromEthAndBurnImmediately() public payable {
        uint256 buyAmount = msg.value.div(2);
        WETH.deposit{value: msg.value}();

        (uint256 reserveDelta, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 outDelta = UniswapV2Library.getAmountOut(buyAmount, wethReserve, reserveDelta);

        WETH.transfer(deltaWethPair, buyAmount);
        IUniswapV2Pair(deltaWethPair).swap(outDelta, 0, address(this), "");

        uint256 optimalDeltaAmount = UniswapV2Library.quote(buyAmount, wethReserve, reserveDelta);
        uint256 optimalWETHAmount;

        if (optimalDeltaAmount > outDelta) {
            optimalWETHAmount = UniswapV2Library.quote(outDelta, reserveDelta, wethReserve);
            optimalDeltaAmount = outDelta;
        } else {
            optimalWETHAmount = buyAmount;
        }

        assert(WETH.transfer(deltaWethPair, optimalWETHAmount));
        assert(IERC20(deltaToken).transfer(deltaWethPair, optimalDeltaAmount));
        
        IUniswapV2Pair(deltaWethPair).mint(deltaWethPair);
        IUniswapV2Pair(deltaWethPair).burn(address(msg.value));
    }

    function mintLpFromEthBuySellAndBurnImmediately() public payable {
        // Keep 50% for swapping after minting
        uint256 buyAmount = msg.value.div(4);
        WETH.deposit{value: msg.value}();

        (uint256 reserveDelta, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 outDelta = UniswapV2Library.getAmountOut(buyAmount, wethReserve, reserveDelta);

        WETH.transfer(deltaWethPair, buyAmount);
        IUniswapV2Pair(deltaWethPair).swap(outDelta, 0, address(this), "");

        uint256 optimalDeltaAmount = UniswapV2Library.quote(buyAmount, wethReserve, reserveDelta);
        uint256 optimalWETHAmount;

        if (optimalDeltaAmount > outDelta) {
            optimalWETHAmount = UniswapV2Library.quote(outDelta, reserveDelta, wethReserve);
            optimalDeltaAmount = outDelta;
        } else {
            optimalWETHAmount = buyAmount;
        }

        assert(WETH.transfer(deltaWethPair, optimalWETHAmount));
        assert(IERC20(deltaToken).transfer(deltaWethPair, optimalDeltaAmount));

        //console.log("DeltaRouterTest:: (Before Mint) 1 DELTA = ", UniswapV2Library.quote(1 ether, reserveDelta, wethReserve), "ETH");
        IUniswapV2Pair(deltaWethPair).mint(deltaWethPair);
        
        // update reserve amounts since we just minted
        (reserveDelta, wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        //console.log("DeltaRouterTest:: (After Mint) 1 DELTA = ", UniswapV2Library.quote(1 ether, reserveDelta, wethReserve), "ETH");

        //console.log("DeltaRouterTest:: Swapping", msg.value.div(2), "ETH for DELTA");
        assert(WETH.transfer(deltaWethPair, msg.value.div(2)));

        uint balanceBefore = IERC20(deltaToken).balanceOf(address(msg.sender));
        uint256 outDelta2 = UniswapV2Library.getAmountOut(msg.value.div(2), wethReserve, reserveDelta);
        IUniswapV2Pair(deltaWethPair).swap(outDelta2, 0, address(msg.sender), "");
        (reserveDelta, wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        //console.log("DeltaRouterTest:: (After Swapping) 1 DELTA = ", UniswapV2Library.quote(1 ether, reserveDelta, wethReserve), "ETH");

        uint balanceAfter = IERC20(deltaToken).balanceOf(address(msg.sender));
        require(balanceAfter.sub(balanceBefore) > 0, "did not receive any delta token");
        //console.log('DeltaRouterTest:: Received', balanceAfter.sub(balanceBefore), 'DELTA');
        
        // Try to burn after swapping
        IUniswapV2Pair(deltaWethPair).burn(address(msg.value));
    }

    function mintLpFromEthBuySell20xAndBurnImmediately() public payable {
        // Keep 50% for swapping after minting
        uint256 buyAmount = msg.value.div(4);
        WETH.deposit{value: msg.value}();

        (uint256 reserveDelta, uint256 wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
        uint256 outDelta = UniswapV2Library.getAmountOut(buyAmount, wethReserve, reserveDelta);

        WETH.transfer(deltaWethPair, buyAmount);
        IUniswapV2Pair(deltaWethPair).swap(outDelta, 0, address(this), "");

        uint256 optimalDeltaAmount = UniswapV2Library.quote(buyAmount, wethReserve, reserveDelta);
        uint256 optimalWETHAmount;

        if (optimalDeltaAmount > outDelta) {
            optimalWETHAmount = UniswapV2Library.quote(outDelta, reserveDelta, wethReserve);
            optimalDeltaAmount = outDelta;
        } else {
            optimalWETHAmount = buyAmount;
        }

        assert(WETH.transfer(deltaWethPair, optimalWETHAmount));
        assert(IERC20(deltaToken).transfer(deltaWethPair, optimalDeltaAmount));

        IUniswapV2Pair(deltaWethPair).mint(deltaWethPair);
        
        bool buyDelta = true;
        uint ethAmountBefore = IERC20(address(WETH)).balanceOf(address(this));
        uint deltaAmountBefore = IERC20(deltaToken).balanceOf(address(this));
        
        console.log('ethAmountBefore', ethAmountBefore);
        console.log('deltaAmountBefore', deltaAmountBefore);
        
        for(uint i = 0; i < 20; i++) {
            (reserveDelta, wethReserve, ) = IUniswapV2Pair(deltaWethPair).getReserves();
            if(buyDelta) {
                uint ethAmount = IERC20(address(WETH)).balanceOf(address(this));
                uint256 deltaAmountOut = UniswapV2Library.getAmountOut(ethAmount, wethReserve, reserveDelta);
                assert(WETH. transfer(deltaWethPair, ethAmount));
                IUniswapV2Pair(deltaWethPair).swap(deltaAmountOut, 0, address(this), "");
            } else {
                uint deltaAmount = IERC20(deltaToken).balanceOf(address(this));
                uint256 ethAmount = UniswapV2Library.getAmountOut(deltaAmount, reserveDelta, wethReserve);
                assert(IERC20(deltaToken).transfer(deltaWethPair, deltaAmount));
                IUniswapV2Pair(deltaWethPair).swap(0, ethAmount, address(this),"");
            }
            buyDelta = !buyDelta;
        }

        uint ethAmountAfter = IERC20(address(WETH)).balanceOf(address(this));
        uint deltaAmountAfter = IERC20 (deltaToken).balanceOf(address(this));
        console.log('ethAmountAfter', ethAmountAfter);
        console.log('deltaAmountAfter', deltaAmountAfter);

        // Try to burn after swapping
        IUniswapV2Pair(deltaWethPair).burn(address(msg.value));
    }
}
