import "./OVLTokenTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol"; 

pragma abicoder v2;
interface IDeltaToken {
    function userInformation(address) external view returns (UserInformation memory);
    function liquidityRebasingPermitted() external view returns (bool);
    function lpTokensInPair() external view returns (uint256);
    function vestingTransactions(address,uint256) external view returns (VestingTransaction memory);

}

interface IOVLTransferHandler {
    function getTransactionDetail(VestingTransaction memory) external view returns (VestingTransactionDetailed memory);
}

contract OVLBalanceHandler {
    using SafeMath for uint256;
    using SafeMath for uint112;

    IDeltaToken immutable DELTA_TOKEN;
    address constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    uint256 constant public QTY_EPOCHS = 7;
    IERC20 immutable public DELTA_X_WETH_PAIR;
    IOVLTransferHandler immutable public TRANSACTION_HANDLER;



    constructor(address _transactionHandler, address pair) public {
        DELTA_TOKEN = IDeltaToken(msg.sender);
        TRANSACTION_HANDLER = IOVLTransferHandler(_transactionHandler);
        DELTA_X_WETH_PAIR = IERC20(pair);
    }

    function handleBalanceCalculations(address account, address sender) public view returns (uint256) {
        UserInformation memory accountInfo = DELTA_TOKEN.userInformation(account);

        // We trick the uniswap router path revert by returning the whole balance
        if(sender == UNISWAP_V2_ROUTER) {
            return accountInfo.maxBalance;

        }

        uint256 mature = accountInfo.maturedBalance;
        // console.log(" # DELTAToken.sol # Collect balances for balanceOf call...");
        while(true) {
            VestingTransactionDetailed memory dtx = TRANSACTION_HANDLER.getTransactionDetail(DELTA_TOKEN.vestingTransactions(account, accountInfo.mostMatureTxIndex)); 


            mature = mature.add(dtx.mature);
            

            // We go until we encounter a empty above most mature tx
            if(accountInfo.mostMatureTxIndex == accountInfo.lastInTxIndex) { 
                break ;
            }
            accountInfo.mostMatureTxIndex++;

            if(accountInfo.mostMatureTxIndex == QTY_EPOCHS) { accountInfo.mostMatureTxIndex = 0; }
        }

        IERC20 _pair = DELTA_X_WETH_PAIR;//gas sav
        // LP Removal protection
        if(sender == address(_pair) && DELTA_TOKEN.liquidityRebasingPermitted() == false) {
            // If the sender is uniswap and is querying balanceOf, this only happens first inside the burn function
            // This means if the balance of LP tokens here went up
            // We should revert
            // LP tokens supply can raise but it can never get lower with this method, if we detect a raise here we should revert
            // Rest of this code is inside the _transfer function
            require(_pair.balanceOf(address(_pair)) == DELTA_TOKEN.lpTokensInPair(), "DELTAToken: Liquidity removal is forbidden");
        }

        return mature;
    }
}