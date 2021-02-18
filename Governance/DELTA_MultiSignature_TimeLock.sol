import "./DELTA_Governance_Relay.sol";
import "./DELTA_Meatspace_Protection.sol";

pragma experimental ABIEncoderV2;

interface IMeatspaceProtector {
    function hasVotingRights(address) external pure returns (bool);
}

contract ExecutorWithTimelock  {
  using SafeMath for uint256;
  
  event FunctionExecution(
          uint256 timestamp,
          address targetAddress,
          address relay,
          address executedBy,
          bytes functionArguments,
          bytes resultData
  );

  event MultisignatorEdited(
      uint256 timestamp,
      address executedBy,
      address targetMultisignator,
      bool isActive, 
      uint256 delegatesCount,
      bool isNewMultisignator
  );

  event RelayCreated(RelayInfo info);

  /// @notice the changeable address for meatspace protector
  /// This contract shoudl work like a canary aka, validate call days for other people, or check in periodically like a canary
  IMeatspaceProtector public meatspaceProtector;

  /// @dev ID used for multisignator array location for easy removal
  mapping(address => uint256) private multisignatorIDs;

  /// @dev number of multisignators for the array indexing purposes, this includes not-active multisignators
  uint256 public numberMultisignators;
  /// @dev array of all multisgnators, in the info struct
  MultiSignatorInfo [] public multisignators;
  /// @notice total delegates as a sum of all multisignators
  uint256 public totalDelegates;

  /// @param delegateCount number of delegates this multisignator has
  /// @param multisignatorAddress address of this multisignator
  /// @param isActive is this multisignator still active or is it disactivated
  struct MultiSignatorInfo {
      uint256 delegateCount;
      address multisignatorAddress;
      bool isActive;
  }

  /// @param relayAddress the relay address for auth purposes
  /// @param targetAddress address of the target contract that the execution will happen
  /// @param isDelegateCall is this a delegate call call?
  /// @param humanReadableName name in human/ape/bot readable format 
  /// @param targetFunctionSignature signature of the target function
  /// @param percentDelegates how many percent delegates are needed to successfully execute this call 1-100 (1% intervals)
  struct RelayInfo {
      address relayAddress;
      address targetAddress;
      bool isDelegateCall;
      string humanReadableName;
      string targetFunctionSignature;
      uint256 percentDelegatesNeeded;
  }
  /// @dev mapping of the information accessible by relay hash which can be gotten with getRelayHash function
  mapping (bytes32 => RelayInfo) public relayInfo;
  
  /// @notice metaRelay which is the only relay permitted to create new relays
  address public immutable metaRelay;

  /// @dev the constructor will create several other contracts
  /// The meta relay which will be used to create all other relays
  /// It will add the multisignator as the msg.caller with all the starting delegates
  /// it will create the stop-gap meatspace protector
  /// @param _startingDelegates Number of delegates that we will add to the contract creator and the total
  /// @param _metaRelayGracePeriodHours grace period where there is 0 delay in the meta relay
  /// @param _metaRelayMaxDelaySeconds max delay for the metaRelay, metaRelay will start with 0 delay and go up to the max over 14 days maturation
  constructor (uint256 _startingDelegates, uint256 _metaRelayGracePeriodHours, uint256 _metaRelayMaxDelaySeconds) public {
      /// Zero minimum , 14 day maturation period, non delegated, 50% consensus
      metaRelay = _createRelay(0, _metaRelayMaxDelaySeconds, 14, _metaRelayGracePeriodHours, address(this), "createRelay(uint256,uint256,uint256,uint256,address,string,string,bool,uint256)", "DELTA - Relay Creating Meta Relay", false, 50);
      /// We make the creator the multisignator
      _editMultisignator(msg.sender, _startingDelegates, true);
      /// We create the stopgap meatspace protector
      meatspaceProtector = IMeatspaceProtector(address(new MeatSpaceProtection()));
      /// @notice create meatspace protector changer contract because of its unprecedented power here
      _createRelay(0, _metaRelayMaxDelaySeconds, 14, _metaRelayGracePeriodHours, address(this), "changeMeatspaceProtector(address,address)", "DELTA - Relay Meatspace Protector", false, 51);
  }


  /// @notice helper function to fetch all info from a multisignator from just an address
  function multisignatorInfo(address person) public view returns (MultiSignatorInfo memory) {
      uint256 id = multisignatorIDs[person];
      require(id > 0, "Multisignator not found");
      MultiSignatorInfo memory info = multisignators[id - 1];
      info.isActive = info.isActive && meatspaceProtector.hasVotingRights(person);
      return info;
  }


  receive()  external payable {
      revert("No eth pls");
  }

  /// @notice returns true if the given address if an active multi signator
  function isActiveMultiSignator(address person) public view returns (bool) {
      MultiSignatorInfo memory info = multisignatorInfo(person);
      return info.isActive;
  }

  /// @notice a self call, this means only timelock allows to create this via the metaRelay
  function changeMeatspaceProtector(address _newProtector, address validMultisignatorWithVotingRightsOnMeatSpaceProtector) public {
      onlyMultisigRelayedCall(); // only timelock allows us to guarantee this is called by a relay aka under timelock
      meatspaceProtector = IMeatspaceProtector(_newProtector);
      bool check = meatspaceProtector.hasVotingRights(validMultisignatorWithVotingRightsOnMeatSpaceProtector);
      require(check, "meatspace protector no work");
  }

  /// @dev helper function that returns a relay hash from the functions signature and target address
  /// Note : it's impossible to create a relay with the same hash twice, stopping any shanenigans
  function getRelayHash(address targetAddress, string memory functionSignature) public pure returns (bytes32){
      return keccak256(abi.encode(targetAddress, functionSignature));
  }

  /// @notice a function that edits a existing multisignator or adds a new one, this function is called only via a relayed called
  /// @dev This function is responsible to everything there is to adding new signators,
  /// Math with total delegate count, setting isactive on each delegates
  /// putting them in various mappings
  /// If this doesn't do something for delegate storage, its safe to assume that its uintended
  function _editMultisignator(address multiSignator, uint256 delegates, bool isActive) internal {

      /// @dev If the new signator edit is active, then we require that it has more than 0 delegates
      if(isActive) { require(delegates > 0, "Enter a non-zero number of delegates"); }
      /// @dev else if its deactivated (!isActive) we require that it has exactly 0
      else { require(delegates == 0, "nonActive can only have 0 delegates"); }
      /// @dev We don't allow multisignators to be address 0
      /// In general we trust that the multisignator address is correct cause this is coming from a multisig
      /// So we assume a proper DD was made
      require(multiSignator != address(0), "Enter a multisignator address");
      
      /// @dev we check that the multisignator exists
      uint256 multisignatorID = multisignatorIDs[multiSignator];
      bool isANewMultisignator = multisignatorID == 0;

      

      if(isANewMultisignator) {
          /// @dev we start indexing from 1 so the check above works, as noone has ID of 0
          numberMultisignators++;
          multisignatorIDs[multiSignator] = numberMultisignators;
          /// @dev if this is a new multisignator we dont allow it to be deactivated because that makes little utility
          require(isActive, "Can't add a non-active signator");
          /// @dev we push it to the array of multisignators, since its not an edit
          multisignators.push(MultiSignatorInfo({
              delegateCount : delegates,
              multisignatorAddress : multiSignator,
              isActive : true
          }));
          /// @dev we add the delegates we just added to the new guy to total
          totalDelegates = totalDelegates.add(delegates);
      } else { /// @dev else its already a multisignator so we edit it
          /// @dev we grab the storage of this multisignator
          MultiSignatorInfo storage multisignatorGettingChanged = multisignators[multisignatorID - 1];
          /// @dev We flip the isActive ( or not in case its the same)
          multisignatorGettingChanged.isActive = isActive;

          /// @dev IF the delegates we are editing this to are equal or bigger than current ones (this means the difference is 0-infinity +)
          if(delegates >= multisignatorGettingChanged.delegateCount) {
              /// @dev  We add to total delegates
              uint256 theDifference = delegates - multisignatorGettingChanged.delegateCount;
              totalDelegates = totalDelegates.add(theDifference);
          } else {/// @dev else its a decrease
              /// @dev we substract from total delegates
              uint256 theDifference = multisignatorGettingChanged.delegateCount - delegates;
              totalDelegates = totalDelegates.sub(theDifference);
          }
          /// @dev we change the delegates of this multisignator after doing the math important!
          multisignatorGettingChanged.delegateCount = delegates;
      }
      


      emit MultisignatorEdited(
        block.timestamp,
        msg.sender,
        multiSignator,
        isActive, 
        delegates,
        isANewMultisignator
      );
  }

  /// @notice this is a self-call only function, this means only a relay can call this function, because a relay calls the execute function, which calls this as the target
  /// @dev all the relevant information and tests are in the _editMultisignator internal function
  function editMultiSignator(address multiSignator, uint256 delegates, bool isActive) public {
      onlyMultisigRelayedCall();
      _editMultisignator(multiSignator, delegates, isActive);
  }

  /// @notice allows the meatspace protector contract to edit multisignators
  /// This is used as a part of governance
  function editMultiSignatorViaGovernance(address multiSignator, uint256 delegates, bool isActive) public {
      require(msg.sender == address(meatspaceProtector), "Invalid caller");
      _editMultisignator(multiSignator, delegates, isActive);
  }


  /// @notice this is a self-call only function, this means only a relay can call this function, because a relay calls the execute function, which calls this as the target
  /// We create the first relay-creating-relay in the constructor
  /// @param gracePeriodHours period in hours that there is no delay at all to execute actions
  /// @param minimumDelaySeconds The minimum delay to execute the funtion AFTER gracePeriod is over
  /// @param maturingTimeDays The time it takes (in days ) for minimum delay to becoem matured delay which is the maximum delay 
  /// @param maturedDelaySeconds the maximum delay 
  /// @param _targetAddress the address the action will be executed at
  /// @param _targetFunctionSignature function signature that will be called on the target address
  /// @param _humanReadableName a human friendly name for the function
  /// @param _isDelegateCall is this delegate call function - note this exists only here and not on the relay
  /// @return addres of the created relay
  function createRelay(uint256 minimumDelaySeconds, uint256 maturedDelaySeconds, uint256 maturingTimeDays,
                       uint256 gracePeriodHours, address _targetAddress, string memory _targetFunctionSignature,
                       string memory _humanReadableName, bool _isDelegateCall, uint256 _percentDelegatesNeeded) public returns (address) {
                
      onlyMultisigRelayedCall();

      return _createRelay(
          minimumDelaySeconds,
          maturedDelaySeconds,
          maturingTimeDays,
          gracePeriodHours,
          _targetAddress,
          _targetFunctionSignature,
          _humanReadableName,
          _isDelegateCall,
          _percentDelegatesNeeded
      );

  }

  /// @notice returns the number of delegates nessesary for the calling contract
  /// @dev the intention of this is to return 1-infinity total delegates needed to do a specific call
  /// This function will return good values only for a relay calling this
  function numberOfDelegatesNeeded(address targetAddress, string memory targetFunction) public view returns (uint256) {
      bytes32 relayHash = getRelayHash(targetAddress, targetFunction);
      require(relayInfo[relayHash].targetAddress != address(0), 'Relay does not exist');
      uint256 neededDelegateCount = totalDelegates.mul(relayInfo[relayHash].percentDelegatesNeeded).div(100);

      // Set the minimum delegate to 1
      if(neededDelegateCount == 0) {
        neededDelegateCount = 1;
      }

      return neededDelegateCount;
  }

  /// @notice internal function that does all the logic there is to creating an relay
  function _createRelay(
      uint256 _minimumDelaySeconds,
      uint256 _maturedDelaySeconds, 
      uint256 _maturingTimeDays,
      uint256 _gracePeriodHours, 
      address _targetAddress, 
      string memory _targetFunctionSignature, 
      string memory _humanReadableName,
      bool _isDelegateCall,
      uint256 _percentDelegatesNeeded) internal returns (address) {
        require(_targetAddress != address(0), 'Invalid target address cannot be 0');

        /// @dev we get the relay hash
        bytes32 relayHash = getRelayHash(_targetAddress, _targetFunctionSignature);

        /// @dev we check the hash of this relay if it already exists we break here
        bool relayWithSameHashAlreadyExists = relayInfo[relayHash].targetAddress != address(0);
        require(relayWithSameHashAlreadyExists == false, "Relay with the same hash already exists");
        /// @dev check the percent delegates is in bounds (1-100)
        require(_percentDelegatesNeeded > 0, "More than 1 delegate is required");
        require(_percentDelegatesNeeded <= 100 , "Hundred is max");


        // constructor(uint256 minimumDelay, uint256 maturedDelay, uint256 maturingTime, uint256 gracePeriod, address targetAddress, string memory targetFunctionSignature, string memory humanReadableName) public {
        /// @dev create the new relay
        address createdRelay = address(new DELTA_Governance_Relay(
          _minimumDelaySeconds,
          _maturedDelaySeconds,
          _maturingTimeDays,
          _gracePeriodHours,
          _targetAddress,
          _targetFunctionSignature,
          _humanReadableName
        ));

    
        RelayInfo memory newRelay = RelayInfo({
            relayAddress : createdRelay,
            targetAddress : _targetAddress,
            isDelegateCall  : _isDelegateCall,
            humanReadableName : _humanReadableName,
            targetFunctionSignature : _targetFunctionSignature,
            percentDelegatesNeeded : _percentDelegatesNeeded
        });

        /// @dev write the relay to the info 
        relayInfo[relayHash] = newRelay;
        emit RelayCreated(newRelay);

        /// @dev return the address
        return createdRelay;
  }


  /// @dev note this is not a modifier on purpose for code readability purposes.
  function onlyMultisigRelayedCall() public view {
    require(msg.sender == address(this), 'ONLY_BY_THIS_TIMELOCK');
  }

  /// @notice a function that does arbitrary calls to other smart contracts originating from this multisig
  /// Note that only relays can call this function and relays guarantee that this function is called depending on the relay timelock rules ( which are different for each relay and accessable int he relay info)
  function execute(address targetAddress, string memory functionSignature, bytes memory functionArguments) public payable returns (bytes memory) { // Note payable is handled by the caller
      /// @dev we get the relay hash for msg.sender and the function signature that the relay wants to call
      bytes32 relayHash = getRelayHash(targetAddress, functionSignature);
      RelayInfo memory relay = relayInfo[relayHash];
      /// @dev we check that the relay is a real relay we made
      require(relay.relayAddress == msg.sender, "Invalid caller");

      /// @dev We create the calldata based ont he function signature and arguments
      bytes memory callData = abi.encodePacked(bytes4(keccak256(bytes(functionSignature))), functionArguments);
      
      /// @dev we make sure its successful and we have a variable to return the data from this call
      bool success;
      bytes memory resultData;

      if (relay.isDelegateCall) {
        // solium-disable-next-line security/no-call-value
        (success, resultData) = relay.targetAddress.delegatecall(callData);
      } else {
        // solium-disable-next-line security/no-call-value
        (success, resultData) = relay.targetAddress.call{value: msg.value}(callData);
      }

      require(success, 'FAILED_ACTION_EXECUTION');

      emit FunctionExecution(
          block.timestamp,
          relay.targetAddress,
          relay.relayAddress,
          msg.sender,
          functionArguments,
          resultData
      );

      return resultData;
  }


}
