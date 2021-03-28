// DELTA-BUG-BOUNTY
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol"; 

import "../common/OVLTokenTypes.sol";
import "../common/OVLVestingCalculator.sol";

import "../interfaces/IOVLBalanceHandler.sol";
import "../interfaces/IOVLTransferHandler.sol";
import "../interfaces/IRebasingLiquidityToken.sol";
import "../interfaces/IDELTA_TOKEN.sol";

contract OVLBalanceHandler is OVLVestingCalculator, IOVLBalanceHandler {
    using SafeMath for uint256;

    IDELTA_TOKEN private immutable DELTA_TOKEN;
    IERC20 private immutable DELTA_X_WETH_PAIR;
    IOVLTransferHandler private immutable TRANSFER_HANDLER;

    address private constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;

    constructor(IOVLTransferHandler transactionHandler, IERC20 pair) {
        DELTA_TOKEN = IDELTA_TOKEN(msg.sender);
        TRANSFER_HANDLER = transactionHandler;
        DELTA_X_WETH_PAIR = pair;
    }

    function handleBalanceCalculations(address account, address sender) external view override returns (uint256) {
        UserInformationLite memory ui = DELTA_TOKEN.getUserInfo(account);
        // We trick the uniswap router path revert by returning the whole balance
        if(sender == UNISWAP_V2_ROUTER ) {
            return ui.maxBalance;
        } 

        // LP Removal protection
        if(sender == address(DELTA_X_WETH_PAIR) && !DELTA_TOKEN.liquidityRebasingPermitted() ) {
            // If the sender is uniswap and is querying balanceOf, this only happens first inside the burn function
            // This means if the balance of LP tokens here went up
            // We should revert
            // LP tokens supply can raise but it can never get lower with this method, if we detect a raise here we should revert
            // Rest of this code is inside the _transfer function
            require(DELTA_X_WETH_PAIR.balanceOf(address(DELTA_X_WETH_PAIR)) == DELTA_TOKEN.lpTokensInPair(), "DELTAToken: Liquidity removal is forbidden");

            // Bail early without doing calculations since its a full sender
            return ui.maxBalance;
        }

        // console.log(" # DELTAToken.sol # Collect balances for balanceOf call...");
        // potentially do i + 1 % epochs
        while (true) {
            uint256 mature = getMatureBalance(DELTA_TOKEN.vestingTransactions(account, ui.mostMatureTxIndex), block.timestamp); 


            ui.maturedBalance = ui.maturedBalance.add(mature);
            

            // We go until we encounter a empty above most mature tx
            if(ui.mostMatureTxIndex == ui.lastInTxIndex) { 
                break;
            }

            ui.mostMatureTxIndex++;

            if(ui.mostMatureTxIndex == QTY_EPOCHS) { ui.mostMatureTxIndex = 0; }
        }


        return ui.maturedBalance;
    }
}