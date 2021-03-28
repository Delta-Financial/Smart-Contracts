// SPDX-License-Identifier: UNLICENSED
// DELTA-BUG-BOUNTY
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import "../../libs/SafeMath.sol";
import 'hardhat/console.sol';
import "../../../interfaces/IDELTA_TOKEN.sol";
import "../../../interfaces/IDEEP_FARMING_VAULT.sol";

contract Enum {
    enum Operation {
        Call,
        DelegateCall
    }
}

interface IDELTA_DISTRIBUTOR{
    function addDevested(address,uint256) external;
}
/// EAch withdrawal creates its own contract and maturity time
/// Withdrawals are only possible via this method

interface IPROXY_FACTORY {
    function createProxy(address) external returns (address);
}



interface IWITHDRAWAL_CONTRACT {
    function intitialize(address _owner,
        uint256 _matuartionTimeSeconds,
        uint256 _principledDelta, // Principle means the base amount that doesnt mature.
        IERC20 _DELTAToken) external;
}
interface IDELTA_MULTISIG {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, Enum.Operation operation) external returns (bool);
}




contract DELTA_Deep_Farming_Vault is IDEEP_FARMING_VAULT {
    using SafeMath for uint256;
    

    function setPriviledges(address withdrawalContract, bool canSendToMatureBalances, bool canRecieveImmatureBalances, bool recievesBalancesWithoutVestingProcess) internal {
        console.log("Delta governance", deltaGovernance());
        console.log("DELTA", address(delta));
        console.log("Beefa balanace", deltaGovernance().balance);
        console.log("block number", block.number);
        console.log("Address DFV", address(this));
        address deltaAddress = address(delta);
        require(deltaAddress != address(0), "set delta first");
        bool success = IDELTA_MULTISIG(deltaGovernance()).execTransactionFromModule(
            deltaAddress,
            0,
            abi.encodeWithSignature("setWhitelists(address,bool,bool,bool)", withdrawalContract, canSendToMatureBalances,canRecieveImmatureBalances,recievesBalancesWithoutVestingProcess),
            Enum.Operation.Call
        );
        require(success, "Did not sucessfully set privileges");
    }   

    constructor (address _proxyFactoryAddress, address _withdrawalContractMasterCopyAddress, address rlp) public {
        require(BOOST_DOWN_WEEK <= BOOST_MAX, "Boost down per week cannot be bigger than max boost, overflow prot");
        WITHDRAWAL_PROXY_FACTORY = IPROXY_FACTORY(_proxyFactoryAddress);
        WITHDRAWAL_CONTRACT_MASTERCOPY = _withdrawalContractMasterCopyAddress;
        RLP = IERC20(rlp);
        require(BOOST_DOWN_WEEK <= BOOST_MAX, "Boost down per week cannot be bigger than max boost, overflow prot");
        _isPaniced = true; // lock everything in the begining
        interimAdmin = msg.sender;
        console.log("Constructor interim admin",interimAdmin);
    }

    function startFarming() public {
        onlyMultisig();
        require(farmingStartedTimestamp == 0, "Farming has already started");
        _isPaniced = false;
        farmingStartedTimestamp = block.timestamp;
        setPriviledges(address(this), true,true,true);
    }

    

    struct UserInformation {
        // Reward debts is used for math trick to achieve O(1) farmed amount
        // We set rewardDebts to exactly amount of accumulted*shares every time a claim is done
        uint256 rewardDebtETH;
        uint256 rewardDebtDELTA;
        // Users farming power this includes, multiplier, rlp,delta principle. And can be stale - meaning too high and 
        // is adjusted every time there is a interaction
        uint256 farmingPower; // rlp*rlpratio + deltaTotal * multipleir
        // Delta balances and total of them to save gas
        uint256 deltaPermanent; // Never withdrawable
        uint256 deltaVesting; // Amount that needs to vest 12 months to be claimable 
        uint256 deltaWithdrawable; // Amount that can be withdrawn right away (with 2 week vesting)
        uint256 totalDelta; // Sum of them all (delta only no rlp)
        uint256 rlp; // amount of rlp this user has
        uint256 lastBoosterDepositTimestamp; // timestamp of the last booster deposit
        uint256 lastBooster; // last booster recorded for this person, this might be too high and is subject to adjustment 
        uint256 lastInteractionBlock; // Block of last interaction, we allow 1 interaction per block of an address
        bool compoundBurn; // A boolean that sets compounding effect, either burn maintaining multiplier or just adding. 
    }


    struct VaultInformation {
        uint256 totalFarmingPower; // A sum of farming power of all users (includes stale ones) // rlp*rlpratio + deltaTotal * multipleir * all users
        // Accumulated balances of each reward token stored in e12 for change
        uint256 accumulatedDELTAPerShareE12; // pending rewards / totalshares *1e12
        uint256 accumulatedETHPerShareE12;
    }

    bool private _isPaniced;
    uint256 public farmingStartedTimestamp;

    mapping(address => UserInformation) public userInfo;
    VaultInformation public vaultInfo;
    // All withdrawal contracts of a person
    mapping(address => address []) public withdrawalContracts;

    struct Rewards {
        uint256 DELTA;
        uint256 ETH;
    }

    Rewards private pendingRewards;
    uint256 constant public RLP_RATIO = 450;
    uint256 constant public BOOST_MAX = 10;
    uint256 constant public BOOST_UP_WEEK = 1;
    uint256 constant public BOOST_DOWN_WEEK = 3;
    IPROXY_FACTORY immutable public WITHDRAWAL_PROXY_FACTORY;
    address constant internal DEAD_BEEF = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF;
    address immutable public WITHDRAWAL_CONTRACT_MASTERCOPY;
    IDELTA_TOKEN public delta;
    IERC20 constant public WETH = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    IERC20 immutable public RLP;
    address internal interimAdmin;
    mapping(address => bool) public isAGuardian;


    /// @dev a normal deposit that will force multiplier to 1 if there is any
    function deposit(uint256 numberRLP, uint256 numberDELTA) override public {
        UserInformation memory reciever = userInfo[msg.sender];
        _deposit(reciever, msg.sender, numberRLP, numberDELTA, false);
    }

    function setDelta(address _delta) public {
        console.log("Interim admin is", interimAdmin);
        require(address(delta) == address(0), "Delta already set");
        require(interimAdmin == msg.sender, "!interimadmin");
        delta = IDELTA_TOKEN(_delta);
        interimAdmin = address(0);
    }

    // Deposit for a individual
    function depositFor(address person, uint256 numberRLP, uint256 numberDELTA) override public {
        require(person != address(0), "Can't deposit for noone");
        UserInformation memory reciever = userInfo[person];
        if(numberDELTA > 0) {
            require(reciever.lastBooster < 2, "Cannot deposit for someone when they have a booster, use the depositWithBurn()");
        }
        _deposit(reciever, person, numberRLP, numberDELTA, false);
    }

    function depositWithBurn(uint256 numberDELTA) override public {
        UserInformation memory reciever = userInfo[msg.sender];
        _deposit(reciever,msg.sender, 0, numberDELTA, true);
    }

    function depositForWithBurn(address person, uint256 numberDELTA) override public {
        require(person != address(0), "Can't deposit for noone");
        UserInformation memory reciever = userInfo[person];
        require(reciever.lastBoosterDepositTimestamp > 0, "Can not deposit burned when the user didn't burn yet");
        _deposit(reciever,person, 0, numberDELTA, true);
    }
    
    function addPermanentCredits(address person, uint256 amount) override public {
        require(msg.sender == delta.distributor(), "!distributor");
        UserInformation storage personStorage = userInfo[person];
        UserInformation memory personMemory = userInfo[person];
        whenNotPaniced();
        onlyOneActionPerBlock(personStorage);
        require(amount > 0, "Can't add nothing");

        (uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) = _updateVault(vaultInfo.totalFarmingPower);

        /////
        // Uses memory pointers 
        /////
        // farmingPower - modified after
        // lastBoosterDepositTimestamp 
        // rlp
        // lastBooster
        // totalDelta
        // rewardDEbtETH
        // rewardDEBTDElta
        (uint256 newBooster, uint256 farmedDELTA, uint256 farmedWETH) = recycle(_realFarmedOfPerson(personMemory, accumulatedDELTAE12, accumulatedETHE12));

        if(farmedWETH > 0) {
            sendETH(person, farmedWETH);
        }

        if(farmedDELTA > 0) { // No need to compound if there is no farmed, as this doesnt add ddeltadeposit
            /////
            // Uses memory pointers 
            /////
            // compoundBurn
            // deltaWithdrawable
            // deltaPermanent
            // deltaVesting
            // totalDelta
            // lastBoosterDepositTimestamp

            /////
            // Sets memory pointers
            /////
            // deltaWithdrawable
            // totalDelta

            /////
            // Sets storage pointers
            /////
            // deltaVesting
            // deltaPermanent
            // deltaWithdrawable
            // totalDelta
            // compoundBurn
            // lastBoosterDepositTimestamp
            newBooster = compoundFarmedAndHandleDELTADeposit(personMemory, personStorage, 0, farmedDELTA, newBooster, false);  // We dont need to set burn booster to true because the farmed is 0
        }

        personStorage.lastBooster = newBooster;
        // We add permanent balance
        personStorage.deltaPermanent = personStorage.deltaPermanent.add(amount);
        // And total balance
        personMemory.totalDelta = personMemory.totalDelta.add(amount);
        personStorage.totalDelta = personMemory.totalDelta;

        /////
        // Uses memory pointers 
        /////
        // farmingPower - only modified here
        // totalDelta - set by compound
        // rlp  - is never modified here

        /////
        // Sets storage pointers
        /////
        // farmingPower
        // rewardDebtDELTA
        // totalFarmingPower
        // rewardDebtETH
        adjustFarmingPowerAndDebt(personStorage, personMemory, accumulatedDELTAE12, accumulatedETHE12, newBooster);
    }

    function _deposit(UserInformation memory recieverMemory, address walletReciever, uint256 amountRLP, uint256 amountDELTA, bool isBurn) internal {
        console.log("dfv :: _deposit()");
        console.log("isBurn",isBurn);

        whenNotPaniced();
        UserInformation storage recieverStorage = userInfo[walletReciever];

        // Flash loan front running protection
        onlyOneActionPerBlock(recieverStorage);

        if(amountDELTA > 0) {
            // User specified he wants to deposit delta so we transfer it here
            require(delta.transferFrom(msg.sender, address(this), amountDELTA), "Coudn't transfer DELTA, allowance?");
        }

        // We update the accumulated rewards in case its not updated so the person is owed
        (uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) = _updateVault(vaultInfo.totalFarmingPower);
        /////
        // Uses memory pointers 
        /////
        // farmingPower - modified after
        // lastBoosterDepositTimestamp 
        // rlp
        // lastBooster
        // totalDelta
        // rewardDEbtETH
        // rewardDEBTDElta
        (uint256 newBooster, uint256 farmedDELTA, uint256 farmedWETH) = recycle(_realFarmedOfPerson(recieverMemory, accumulatedDELTAE12, accumulatedETHE12));

        /////
        // Uses memory pointers 
        /////
        // compoundBurn
        // deltaWithdrawable
        // deltaPermanent
        // deltaVesting
        // totalDelta
        // lastBoosterDepositTimestamp

        /////
        // Sets memory pointers
        /////
        // deltaWithdrawable
        // totalDelta

        /////
        // Sets storage pointers
        /////
        // deltaVesting
        // deltaPermanent
        // deltaWithdrawable
        // totalDelta
        // compoundBurn
        // lastBoosterDepositTimestamp
        newBooster = compoundFarmedAndHandleDELTADeposit(recieverMemory, recieverStorage, amountDELTA, farmedDELTA, newBooster, isBurn);

        if(farmedWETH > 0) {
            sendETH(walletReciever, farmedWETH); // This is to the person who farmed it not msg.sender..
        }

        console.log("Amoutn RLP", amountRLP);

        if(amountRLP > 0) {
            // User wants to deposit RLP so we transfer it from him here
            require(RLP.transferFrom(msg.sender, address(this), amountRLP), "Coudn't transfer RLP, allowance?");
            // We write a new number or rlp to the user
            recieverMemory.rlp = recieverMemory.rlp.add(amountRLP); // THis is needed cause memory pointer is used in adjustFarmingPowerAndDebt
            recieverStorage.rlp = recieverMemory.rlp;
        }

        // Cap and write to storage
        if(newBooster > BOOST_MAX) { newBooster = BOOST_MAX; }
        recieverStorage.lastBooster = newBooster;

        // We finished calculating total delta write it to stroage
        // Note we have to always write here because there might be compound even tho there was no deltadeposit
        recieverStorage.totalDelta = recieverMemory.totalDelta;

        // TODO : sanity check remove after
        console.log("recieverMemory.totalDelta", recieverMemory.totalDelta);
        console.log("recieverStorage.deltaWithdrawable", recieverStorage.deltaWithdrawable);
        console.log("recieverStorage.deltaPermanent", recieverStorage.deltaPermanent);
        console.log("recieverStorage.deltaVesting", recieverStorage.deltaVesting);
        console.log("Aclculated total", recieverStorage.deltaWithdrawable + recieverStorage.deltaPermanent + recieverStorage.deltaVesting);
        require(recieverMemory.totalDelta == recieverStorage.deltaWithdrawable + recieverStorage.deltaPermanent + recieverStorage.deltaVesting 
        || recieverMemory.totalDelta - 1 == recieverStorage.deltaWithdrawable + recieverStorage.deltaPermanent + recieverStorage.deltaVesting, "total does not line up");


        /////
        // Uses memory pointers 
        /////
        // farmingPower
        // totalDelta 
        // rlp 

        /////
        // Sets storage pointers
        /////
        // farmingPower
        // rewardDebtDELTA
        // totalFarmingPower
        // rewardDebtETH
        adjustFarmingPowerAndDebt(recieverStorage, recieverMemory, accumulatedDELTAE12, accumulatedETHE12, newBooster);
    }

    function compound(address person) override public {
        require(person != address(0), "Provide an address");
        UserInformation storage personStruct = userInfo[person];
        _deposit(personStruct, person, 0, 0, false); // Because of the 0 deposit we can get away with 0,0 while the user has compoundBurn on
    }

    /// @notice a function that withdraws everything user has in the vault
    /// And creates a withdrawl contract
    function exit() override public {
        console.log("DFV :: exit()");
        whenNotPaniced();
        UserInformation storage exitingStorage = userInfo[msg.sender];
        UserInformation memory exitingMemory = userInfo[msg.sender];

        onlyOneActionPerBlock(exitingStorage);

        (uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) = _updateVault(vaultInfo.totalFarmingPower);
        uint256 oldFarmingPower = exitingMemory.farmingPower;
        /////
        // Uses memory pointers 
        /////
        // farmingPower - modified after
        // lastBoosterDepositTimestamp 
        // rlp
        // lastBooster
        // totalDelta
        // rewardDEbtETH
        // rewardDEBTDElta
        (, uint256 farmedDELTA, uint256 farmedWETH) = recycle(_realFarmedOfPerson(exitingMemory, accumulatedDELTAE12, accumulatedETHE12));

        if(farmedWETH > 0) {
            sendETH(msg.sender, farmedWETH);
        }

        if(exitingMemory.rlp > 0) {
            RLP.transfer(msg.sender, exitingMemory.rlp);
        }
        console.log("MasterCopy",WITHDRAWAL_CONTRACT_MASTERCOPY);
        address withdrawalContract = WITHDRAWAL_PROXY_FACTORY.createProxy(WITHDRAWAL_CONTRACT_MASTERCOPY);
        withdrawalContracts[msg.sender].push(withdrawalContract);
        uint256 withdrawable = exitingMemory.deltaWithdrawable;

        setPriviledges(withdrawalContract, true,false,true);
        // We send withdrwable, vesting and whatever was farmed cause we dotn compound it
        uint256 totalToSendToWithdrawalContract = withdrawable.add(exitingMemory.deltaVesting).add(farmedDELTA);
        require(totalToSendToWithdrawalContract > 0, "Nothing to withdraw");

        sendDELTA(withdrawalContract, totalToSendToWithdrawalContract);
        IWITHDRAWAL_CONTRACT(withdrawalContract).intitialize(msg.sender, 52 weeks, withdrawable, delta);

        uint256 permanentBalance = exitingMemory.deltaPermanent; // Note that we dont compound here so its fine that the compounding function sets it in storage because we dont use it here since we want to be fair to user

        delete userInfo[msg.sender];

        // We have to handle permanetn balance of this user
        if(permanentBalance > 0){
            exitingStorage.deltaPermanent = permanentBalance;
            exitingStorage.totalDelta = permanentBalance;
            exitingStorage.rewardDebtDELTA = accumulatedDELTAE12.mul(permanentBalance);
            exitingStorage.rewardDebtETH = accumulatedETHE12.mul(permanentBalance);
            exitingStorage.farmingPower = permanentBalance;
            vaultInfo.totalFarmingPower = vaultInfo.totalFarmingPower.sub(oldFarmingPower).add(permanentBalance);
        } else {
            // Delete is sufficient we just have to adjust  total farming (user had no permanent balance)
            vaultInfo.totalFarmingPower = vaultInfo.totalFarmingPower.sub(oldFarmingPower);
        }
    }


    function withdrawRLP(uint256 amount) override public {
        whenNotPaniced();
        UserInformation storage withdrawerStorage = userInfo[msg.sender];
        UserInformation memory withdrawerMemory = userInfo[msg.sender];
        onlyOneActionPerBlock(withdrawerStorage);

        require(amount > 0, "Cannot withdraw 0 ");
        require(withdrawerMemory.rlp >= amount, "Not enough to withdraw");

        (uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) = _updateVault(vaultInfo.totalFarmingPower);
        
        /////
        // Uses memory pointers 
        /////
        // farmingPower - modified after
        // lastBoosterDepositTimestamp 
        // rlp
        // lastBooster
        // totalDelta
        // rewardDEbtETH
        // rewardDEBTDElta
        (uint256 newBooster, uint256 farmedDELTA, uint256 farmedWETH) = recycle(_realFarmedOfPerson(withdrawerMemory, accumulatedDELTAE12, accumulatedETHE12));

        if(farmedWETH > 0) {
            sendETH(msg.sender, farmedWETH);
        }

        if(farmedDELTA > 0) { // No need to compound if we didnt farm cause this doesn't add delta
            /////
            // Uses memory pointers 
            /////
            // compoundBurn
            // deltaWithdrawable
            // deltaPermanent
            // deltaVesting
            // totalDelta
            // lastBoosterDepositTimestamp

            /////
            // Sets memory pointers
            /////
            // deltaWithdrawable
            // totalDelta

            /////
            // Sets storage pointers
            /////
            // deltaVesting
            // deltaPermanent
            // deltaWithdrawable
            // totalDelta
            // compoundBurn
            // lastBoosterDepositTimestamp
            newBooster = compoundFarmedAndHandleDELTADeposit(withdrawerMemory, withdrawerStorage, 0, farmedDELTA, newBooster, false);  // We dont need to set burn booster to true because the farmed is 0
        }

        withdrawerMemory.rlp = withdrawerMemory.rlp - amount; // safe cause require
        withdrawerStorage.rlp = withdrawerMemory.rlp;
        withdrawerStorage.lastBooster = newBooster;

        /////
        // Uses memory pointers 
        /////
        // farmingPower
        // totalDelta 
        // rlp 

        /////
        // Sets storage pointers
        /////
        // farmingPower
        // rewardDebtDELTA
        // totalFarmingPower
        // rewardDebtETH
        adjustFarmingPowerAndDebt(withdrawerStorage, withdrawerMemory, accumulatedDELTAE12, accumulatedETHE12, newBooster);

        RLP.transfer(msg.sender, amount);
    }


    ////
    // Helpers
    ///
    function realFarmedOfPerson(address person) public override view returns (RecycleInfo memory) {
        UserInformation memory personStruct = userInfo[person];

        (uint256 totalDELTApreAdjust, uint256 totalETHpreAdjust) = 
            calculateFarmed(
                personStruct.farmingPower,
                vaultInfo.accumulatedDELTAPerShareE12,
                vaultInfo.accumulatedETHPerShareE12,
                personStruct.rewardDebtDELTA,
                personStruct.rewardDebtETH
            );

        return adjustFarmedView(personStruct.lastBooster, totalDELTApreAdjust, totalETHpreAdjust, personStruct.lastBoosterDepositTimestamp, personStruct.totalDelta, personStruct.rlp, block.timestamp);
    }

    /////
    // Uses memory pointers 
    /////
    // farmingPower
    // totalDelta 
    // rlp 

    /////
    // Sets storage pointers
    /////
    // farmingPower
    // rewardDebtDELTA
    // totalFarmingPower
    // rewardDebtETH
    function adjustFarmingPowerAndDebt(UserInformation storage personStorage, UserInformation memory personMemory, uint256 accumulatedDELTAE12, uint256 accumulatedETHE12, uint256 newBooster) internal {
        uint256 newFarmingPower = personMemory.rlp.mul(RLP_RATIO).add( personMemory.totalDelta.mul(newBooster) );
        // Remove old farming power and add new one
        vaultInfo.totalFarmingPower = vaultInfo.totalFarmingPower.sub(personMemory.farmingPower).add(newFarmingPower);
        // Set farming powers and debts
        personStorage.farmingPower = newFarmingPower;
        personStorage.rewardDebtDELTA = newFarmingPower.mul(accumulatedDELTAE12);
        personStorage.rewardDebtETH = newFarmingPower.mul(accumulatedETHE12);

        console.log("DFV :: adjustFarmingPowerAndDebt()");
        console.log("newBooster",newBooster);
        console.log("personMemory.farmingPower",personMemory.farmingPower);
        console.log("newFarmingPower", newFarmingPower);
        console.log("accumulatedDELTAE12", accumulatedDELTAE12);
        console.log("rewardDebtETH", accumulatedETHE12);

    }

    function _realFarmedOfPerson(UserInformation memory person, uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) internal view
        returns (RecycleInfo memory)
    {
        (uint256 totalDELTApreAdjust, uint256 totalETHpreAdjust) = 
            calculateFarmed(person.farmingPower, accumulatedDELTAE12, accumulatedETHE12, person.rewardDebtDELTA, person.rewardDebtETH);

        // adjustFarmedView(uint256 booster, uint256 farmedDELTA, uint256 farmedETH, uint256 lastBoosterDeposit, uint256 deltaPrinciple, uint256 amountRLP, uint256 currentTimestamp) 
       return adjustFarmedView(person.lastBooster, totalDELTApreAdjust, totalETHpreAdjust, person.lastBoosterDepositTimestamp, person.totalDelta, person.rlp, block.timestamp);
    }


    function addNewRewards(uint256 amountDELTA, uint256 amountWETH) override public {
        console.log("Address dfv",address(this));
        require(delta.transferFrom(msg.sender, address(this), amountDELTA), "Couldn't transfer DELTA, allowance?");
        require(WETH.transferFrom(msg.sender, address(this), amountWETH), "Couldn't transfer WETH, allowance?");
        pendingRewards.ETH = pendingRewards.ETH.add(amountWETH);
        pendingRewards.DELTA = pendingRewards.DELTA.add(amountDELTA);
    }


    function adminRescueTokens(address token, uint256 amount) override public { 
        onlyMultisig();
        if(_isPaniced == false) {
            require(token != address(RLP) && token != address(delta) && token != address(WETH), "Cannot withdraw tokens that are rewards or used in farming");
        } 
        IERC20(token).transfer(msg.sender, amount);
    }



    function setCompundBurn(bool shouldBurn) override public {
        whenNotPaniced();
        UserInformation storage recieverStorage = userInfo[msg.sender];

        // Flash loan front running protection
        onlyOneActionPerBlock(recieverStorage);
        recieverStorage.compoundBurn = shouldBurn;
    }

    struct RecycledFarmingValues {
        uint256 delta;
        uint256 eth;
        uint256 percentLegit;
        uint256 calculatedBooster;
    }

    // TODO make puire after removing console logs
    function recycledValuesFromFarmed(uint256 farmedDELTA, uint256 farmedETH, uint256 percentFarmedWithDELTA, uint256 booster, uint256 currentTimestamp, uint256 lastBoosterDeposit) internal view returns (RecycledFarmingValues memory out) {
        console.log("DFV :: recycledValuesFromFarmed()");

        (uint256 _calculatedBooster, uint256 _percentLegit) = howMuchOfFarmedPercentIsLegit(booster, currentTimestamp - lastBoosterDeposit);
        console.log("_calculatedBooster", _calculatedBooster);
        console.log("_percentLegit", _percentLegit);
        console.log("percentFarmedWithDELTA", percentFarmedWithDELTA);

        out.percentLegit = _percentLegit;
        out.calculatedBooster = _calculatedBooster;
        // 100 farmed * 60% * (100 - 50%legit ) / 1e4 = 30
        out.delta = farmedDELTA.mul(percentFarmedWithDELTA).mul( 100 - _percentLegit ).div(1e4); // we can percentLegfit inside howMuchFarmed function to max 100
        out.eth = farmedETH.mul(percentFarmedWithDELTA).mul( 100 - _percentLegit ).div(1e4);
    }

    // Todo make pure after removing console logs
    function adjustFarmedView(uint256 booster, uint256 farmedDELTA, uint256 farmedETH, uint256 lastBoosterDeposit, uint256 deltaPrinciple, uint256 amountRLP, uint256 currentTimestamp) 
        internal view returns (RecycleInfo memory) {
        console.log("DFV :: adjustFarmedView()");

        uint256 farmingPowerRLP = amountRLP.mul(RLP_RATIO);
        uint256 farmingPowerDelta = deltaPrinciple.mul(booster); // This code block has to be before adjustiing the booster
        uint256 percentFarmedWithDELTA = 100;
        if(farmingPowerRLP > 0) {
            if(farmingPowerRLP > farmingPowerDelta) {
                percentFarmedWithDELTA = farmingPowerDelta.mul(100).div(farmingPowerRLP);
            } else {
                percentFarmedWithDELTA = 100 - farmingPowerRLP.mul(100).div(farmingPowerDelta);
            }
        }
           
        if(booster < 2) {//booster is smaller than 2 so 0 or 1
            booster = 1;
            return RecycleInfo(booster, farmedDELTA, farmedETH, 0, 0);
        }
        
        // booster > 1
        // We check how much of farmed is legit.
        // First we substract farmed with rLP from farmed
        // If the remainer is higher than 0
        
                                         
        if(percentFarmedWithDELTA > 0) {
            // We adjust the remainer
            RecycledFarmingValues memory rValues = recycledValuesFromFarmed(farmedDELTA, farmedETH, percentFarmedWithDELTA, booster, currentTimestamp, lastBoosterDeposit);

            if(rValues.calculatedBooster != booster) {
                booster = rValues.calculatedBooster;
                farmedDELTA = farmedDELTA.sub(rValues.delta);
                farmedETH = farmedETH.sub(rValues.eth);
                console.log("booster",booster);

                return RecycleInfo(booster, farmedDELTA, farmedETH, rValues.delta, rValues.eth);
            }
        }

        console.log("booster outer",booster);
        return RecycleInfo(booster, farmedDELTA, farmedETH, 0, 0);
        
    }

    /// @dev A safety function that allows the account to be updated once per block
    /// The issue here is you could flash loan rLP just before to front run a distributor addition and gain free money
    function onlyOneActionPerBlock(UserInformation storage user) internal {
        require(user.lastInteractionBlock != block.number, "Cannot interact in the same block");
        user.lastInteractionBlock = block.number;
    }



    /////
    // Uses memory pointers 
    /////
    // compoundBurn
    // deltaWithdrawable
    // deltaPermanent
    // deltaVesting
    // totalDelta
    // lastBoosterDepositTimestamp

    /////
    // Sets memory pointers
    /////
    // deltaWithdrawable
    // totalDelta

    /////
    // Sets storage pointers
    /////
    // deltaVesting
    // deltaPermanent
    // deltaWithdrawable
    // totalDelta
    // compoundBurn
    // lastBoosterDepositTimestamp
    function compoundFarmedAndHandleDELTADeposit(UserInformation memory personMemory, UserInformation storage personStorage, uint256 depositDELTA, uint256 farmedDELTA, uint256 calculatedBooster, bool isBurn) internal returns (uint256) { //  return new booster 

// Options for this:
// --
// Normal deposit - adding delta to get additional farm power (multiplier set to 1)
// Normal deposit w/ compounding burn (reverts - rekts their compounding)
// Burning deposit (regular compounding) - adding 100% of delta to get farm power, but half burned (moved to permanent balance) - this maintains their booster if more than 10%, or creates 10x multiplier if initial deposit
//      note: must burn at least 100% of total delta so far in the 1x vesting. (if this is first boosted deposit - booster of 0)
//      example: if i have 100 coins farming at 1x, and then i do a 150 burning deposit, it reverts because that is less than burning 100% of their current coins
//      example 2: if i have 100 coins farming at 1x, and then i do a 200 burning deposit, it doesn't revert, but credits me and starts a 10x
// Burning deposit w/ compounding burn - adds 100% of the deposited delta to farm power, burns half, and burns half of farmable during the compounding process.
//      note: must burn (sum 50% of deposit, 50% of farmable from comoounding) at least 100% of total delta so far in the 1x vesting. (if this is first boosted deposit - booster of 0)

// Once deposited, coins can go to a few places:
// --
// 1. Delta permanent - Can never remove, but it gives you farm power
// 2. Delta vesting - Gained from farming. When you withdraw, it creates a contract, where it vests for a year, like delta tokens themselves. You can liquidate it early, and forfeit remainder. 15% goes to their permanent balance, 85% goes out to distributor (subject to change)
// 3. Delta withdrawable - Withdraw in 2 weeks. This is initial deposit. (or 50% of initial deposit, if its a burning deposit)
        console.log("dfv :: compoundFarmedAndHandleDELTADeposit()");
        console.log("isBurn", isBurn);
        console.log("Farmed delta", farmedDELTA);
        uint256 toBurn; // We can burn from deposit of compounding
        bool burningDeposit = isBurn && depositDELTA > 0;
        bool compondingBurn = personMemory.compoundBurn && farmedDELTA > 0;
        uint256 newBooster = calculatedBooster;

        console.log("compondingBurn",compondingBurn);
        console.log("burningDeposit",burningDeposit);

        if(burningDeposit) { // Its a burn deposit // we make sure it has non 0 deposit
            uint256 halfOfDeltaDeposit = depositDELTA / 2;
            personMemory.deltaWithdrawable = personMemory.deltaWithdrawable.add(halfOfDeltaDeposit);
            toBurn = toBurn.add(halfOfDeltaDeposit);
        } else if(depositDELTA > 0) { // This is a normal deposit, so we have to force booster to 1
            require(!compondingBurn, "Can not do normal deposits when compoundBurn is on, uncheck it or do a burn deposit");
            // We set into storage because it is not componding burn or normal deposit
            personStorage.deltaWithdrawable = personMemory.deltaWithdrawable.add(depositDELTA);
            newBooster = 1; // We set booster to 1 on normal deposit 
        }

        if(compondingBurn) { // If this is a burning compound and we have farmed delta
            uint256 halfOfFarmedDelta = farmedDELTA / 2;
            toBurn = toBurn.add(halfOfFarmedDelta);
            // Is the compound and deposited bigger than 10% of total we increment booster
            // We burn half and add it
            personStorage.deltaVesting = personMemory.deltaVesting.add(halfOfFarmedDelta);
        } else if(farmedDELTA > 0) { // This is still a compound but a normal one since we have farmed.
            // Note that this will add to deltaVesting and not reduce the multiplier to 1
            personStorage.deltaVesting = personMemory.deltaVesting.add(farmedDELTA);
        }

        // If this is a normal deposit and compounding burn it fails. So the OR is only when its a burning deposit and not compounding burn which still makes this logic sound
        if(burningDeposit || compondingBurn) { // We had a half and half
            personStorage.deltaPermanent = personMemory.deltaPermanent.add(toBurn);
            burn(toBurn);
            personStorage.deltaWithdrawable = personMemory.deltaWithdrawable; // One of them might be burn and other not

            // 5% of total = 10% of total burn deposit
            if(toBurn.mul(20) >= personMemory.totalDelta && block.timestamp >= personMemory.lastBoosterDepositTimestamp + 7 days) {
                personStorage.lastBoosterDepositTimestamp = block.timestamp;
                if(block.timestamp <= personMemory.lastBoosterDepositTimestamp + 14 days) {
                    newBooster = personStorage.lastBooster + 1; // Unupdated storage variable (the hightened booster)
                } else {
                    newBooster += BOOST_UP_WEEK;
                }
            } else if (compondingBurn) { // We are doing a compounding burn and we dont have enough to put the modifier up or there isnt enough time, we revert because thats abusable with depositFor
                require(block.timestamp >= personMemory.lastBoosterDepositTimestamp + 14 days, "Cannot use compounding burn without getting boost up, uncheck compounding burn, or wait 14 days");
            }

            // Note if you farmed 2x your principle you can get fast tracked to burn easily
            // This means rLP can have a burn compound most likely forever until their principle gets huge compared to rlp stack
            if(personMemory.lastBoosterDepositTimestamp == 0) {
                console.log("First burning deposit");
                // toBurn will be 50% of compound + deposiut if its burned
                // This means you have to deposit 2x that
                require(personMemory.totalDelta <= toBurn, "Uncheck compounding burn, or deposit more. You have to deposit and compound with burn at least 2x your total delta.");
                newBooster = BOOST_MAX;
                // we default to compound burn for users sake, they can change it if they please
                personStorage.compoundBurn = true;
            }
        }

        // We set total delta after the requirement statements so its not hightened
        personMemory.totalDelta = personMemory.totalDelta.add(depositDELTA).add(farmedDELTA);  // Memory is used later
        personStorage.totalDelta = personMemory.totalDelta;

        if(newBooster > BOOST_MAX) {
            return BOOST_MAX;
        }
        return newBooster;
    }


    function sendETH(address person,uint256 amount) internal {
        WETH.transfer(person, amount);
    }

    function sendDELTA(address person, uint256 amount) internal {
        delta.transfer(person, amount);
    }   

    function burn(uint256 amount) internal {
        sendDELTA(DEAD_BEEF, amount);
    }

    function recycle(RecycleInfo memory ri) internal returns (uint256 booster, uint256 farmedDELTA, uint256 farmedETH) {
        if(ri.recycledETH > 0) {
            uint256 toSenderETH = ri.recycledETH / 100;
            sendETH(msg.sender, toSenderETH);
            pendingRewards.ETH = pendingRewards.ETH.add(ri.recycledETH - toSenderETH);
        }

        if(ri.recycledDelta > 0) {
            uint256 toSenderDELTA = ri.recycledDelta / 100;
            sendDELTA(msg.sender, toSenderDELTA);
            pendingRewards.DELTA = pendingRewards.DELTA.add(ri.recycledDelta - toSenderDELTA);
        }

        return (ri.booster, ri.farmedDelta, ri.farmedETH);
    }



    // Returns the total farmed not adjusted of person
    function calculateFarmed(
            uint256 farmingPower,
            uint256 accumulatedDELTAE12,
            uint256 accumulatedETHE12,
            uint256 rewardDebtDELTA, 
            uint256 rewardDebtETH) 
        internal pure returns(uint256 farmedDELTA, uint256 farmedETH) {

        farmedDELTA = (accumulatedDELTAE12.mul(farmingPower).sub(rewardDebtDELTA)) / 1e12;
        farmedETH = (accumulatedETHE12.mul(farmingPower).sub(rewardDebtETH)) / 1e12;
    }

    function _updateVault(uint256 totalFarmingPower) internal returns (uint256 accumulatedDELTAE12, uint256 accumulatedETHE12) {
        console.log("DFV :: _updateVault()");
        uint256 pendingDELTA = pendingRewards.DELTA;
        uint256 pendingETH = pendingRewards.ETH;
        accumulatedDELTAE12 = vaultInfo.accumulatedDELTAPerShareE12;
        accumulatedETHE12 = vaultInfo.accumulatedETHPerShareE12;

        if(totalFarmingPower == 0) { return (accumulatedDELTAE12, accumulatedETHE12); console.log("Total farming power is 0 returning"); } // div by 0 errors
        delete pendingRewards;

        if(pendingDELTA > 0) {
            accumulatedDELTAE12 = accumulatedDELTAE12.add(  pendingDELTA.mul(1e12) / totalFarmingPower ); // total farming power isnt 0, so no need to safemath
            vaultInfo.accumulatedDELTAPerShareE12 = accumulatedDELTAE12;
        }

        if(pendingETH > 0) {
            accumulatedETHE12 = accumulatedETHE12.add(  pendingETH.mul(1e12) / totalFarmingPower ); // ditto
            vaultInfo.accumulatedETHPerShareE12 = accumulatedETHE12;
        }

        console.log("accumulatedDELTAE12", accumulatedDELTAE12);
        console.log("accumulatedETHE12", accumulatedETHE12);

    }



    /// Styling choices are on purpose for code readability
    function whenNotPaniced() internal view  {
        // NOT is paniced
        require(!_isPaniced, "Emergency mode is active, all actions are paused");
    }

    function deltaGovernance() public view returns (address) {
        if(address(delta) == address(0)) {return address(0); }
        return delta.governance();
    }
    
    function onlyMultisig() private view {
        require(msg.sender == deltaGovernance(), "!governance");
    }


    /// @notice a guardian can emergency shutdown the vault, only multisig can restore
    function emergencyShutdown(bool stopPanicMultisigOnly) public {
        require(isAGuardian[msg.sender] || msg.sender == deltaGovernance(), "!guardian");

        _isPaniced = true;

        /// Note this is in case a guardian is rogue, we rather have it shut down then have another guardian exploit it.
        if(stopPanicMultisigOnly) {
            onlyMultisig();
            _isPaniced = false;
        }
    }

    function editGuardianRole(address person, bool isGuardian) public {
        onlyMultisig();
        isAGuardian[person] = isGuardian;
    }



    // How many boosts would have been lost in the given time frame
    function boostDecayQtyInDuration(uint256 secondsSinceLastBoost) internal pure returns (uint256) {
        return secondsSinceLastBoost.div(1 weeks).mul(BOOST_DOWN_WEEK);
    }

    // Calculate a booster after a given time frame has passed
    function boosterAfterDuration(uint256 secondsSinceLastBoost, uint256 previousBooster) internal pure returns (uint256) {
        uint256 boostDecayQty = boostDecayQtyInDuration(secondsSinceLastBoost);
        if(boostDecayQty >= previousBooster) {
            return 1;
        }
        return previousBooster - boostDecayQty;
    }

    
    /// @dev pure functions that returns recycled and claimed tokens 
    // TODO change to pureaftertesting
    function howMuchOfFarmedPercentIsLegit(uint256 previousBooster, uint256 secondsSinceLastBoost) public view returns (uint256 newBooster, uint256 claimable) {
        console.log("DFV :: howMuchOfFarmedPercentIsLegit()");
        // Get the total amount farmed on this inflated booster
        // To calculate ho wmuch to recycle, we take the last boost time
        // Then apply formula to reduce it until its 1
        // we calculate a period of time under each booster

        // I farmed total 100 tokens, i have 10x booster with that
        // But my real booster is now 8x
        // This means I spent 1 week with 10x booster
        // 1 week with 9x booster
        // incomplete week with 8x booster lets say 1 full week for ease of math
        // So i should be earning 100 *10/10 33%  = 33
        // 100 * 9 /10 * 33% = 29.7
        // 100 * 8 /10 * 33% = 26.4
        // Total 89.1
        console.log("Previous booster", previousBooster);
        // Determine the current booster/multiplier after decay has occurred since our last boost
        if(7 days > secondsSinceLastBoost) { return (previousBooster, 100); }

        newBooster = boosterAfterDuration(secondsSinceLastBoost, previousBooster);
        // If we are not going down from the booster, we just return the total amount and recycle nothing
        if(newBooster == previousBooster) { return (previousBooster, 100); }

        uint256 weekNum;

        uint256 accumulatedBoostTimePercentages = 0;
        while(true) {
            // Navigate down through the various boost levels until we hit 1
            uint256 thisBooster;
            uint256 jumpDistance = weekNum * BOOST_DOWN_WEEK;
            if(previousBooster <= jumpDistance + 1) {
                thisBooster = 1;
            }
            else {
                thisBooster = previousBooster - jumpDistance;
            }
            
            // 
            uint256 secondsThisBooster = 1 weeks;
            if(weekNum == secondsSinceLastBoost.div(1 weeks) || thisBooster == 1 ) { // this is the partial // or potentially multi week stuck at 1
                // We are still actively in this week of decay (or just down to booster of 1)
                secondsThisBooster = secondsSinceLastBoost - weekNum * 1 weeks ;
                uint256 boosterRatioE2 = thisBooster.mul(1e2).div(previousBooster);
                // uint256 percentOfTimeSpentInThisBoosterE2 = secondsThisBooster.mul(1e2).div(secondsSinceLastBoost);
                uint256 percentOfTimeSpentInThisBoosterE2 = 100 - accumulatedBoostTimePercentages;
                claimable = claimable.add( 
                     uint256(100).mul(boosterRatioE2).mul(percentOfTimeSpentInThisBoosterE2).div(1e4) 
                );
                console.log("PARTIAL WK adding to claimable: (added, total) ", uint256(100).mul(boosterRatioE2).mul(percentOfTimeSpentInThisBoosterE2).div(1e4), claimable);
                break;
            } else {
                // This entire week has passed
                uint256 percentOfTimeSpentInThisBoosterE2 = secondsThisBooster.mul(1e2).div(secondsSinceLastBoost);
                accumulatedBoostTimePercentages += percentOfTimeSpentInThisBoosterE2;
                uint256 boosterRatioE2 = thisBooster.mul(1e2).div(previousBooster);

                claimable = claimable.add( 
                        uint256(100).mul(boosterRatioE2).mul(percentOfTimeSpentInThisBoosterE2).div(1e4) 
                );
                console.log("ENTIRE WK adding to claimable: (added, total) ", uint256(100).mul(boosterRatioE2).mul(percentOfTimeSpentInThisBoosterE2).div(1e4) , claimable);
            }
            weekNum++;
        }

        console.log("claimable is", claimable);
        require(claimable <= 100, "DELTA_Deep_Farming_Vault: Claimable should never exceed 100%");
        require(claimable >= 10, "DELTA_Deep_Farming_Vault: Claimable should never be lower than 10%"); // Over time it approaches 10% never meets it but inprecision has to be accoutned for

    }
    







}