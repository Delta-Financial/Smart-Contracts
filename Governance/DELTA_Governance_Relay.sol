// /// This contract is responsible for one action on one another contract
// /// It relies a instruction to the multisig to call a specific contract

// /// Multisig > Create Relay 
// /// Relay start action > multisig validate callers 
// /// Relay execute action > multisig executes action with relaysOnly
// import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

interface IDELTAMultiSignature {
  function numberOfDelegatesNeeded(address targetAddress, string memory) external view returns (uint256);
  function isActiveMultiSignator(address) external returns (bool);
  function execute(address targetAddress, string memory, bytes memory) external returns (bytes memory);
  function multisignatorInfo(address) external view returns (uint256, address, bool);
}

contract DELTA_Governance_Relay {
  using SafeMath for uint256;
  
  event YesVoteCast(address byWho, bytes  forArguments, uint256 timestamp);
  event VoteCancelled(address byWho, bytes  forArguments, uint256 timestamp);
  event ExecutionCancelled(address byWho, bytes whatArguments, uint256 timestamp);
  event ExecutionMaturationStarted(address byWho, bytes whatArguments, uint256 timestamp);

  /// @notice minimum delay, meaning the starting delay after grace period is over.
  uint256 public MINIMUM_DELAY_SECONDS;
  /// @notice maximum delay after the maturity process is complete
  uint256 public MATURED_MAXIMUM_DELAY_SECONDS;
  /// @notice days it takes to mature meaning achieve the maximum delay
  uint256 public immutable MATURING_TIME_DAYS;
  /// @notice grace period is a period of time no delay to execute is present, and no consensus is nessesary
  uint256 public immutable GRACE_PERIOD_HOURS;
  /// @notice hash of this relay, for lookup in master contract
  /// @dev this is made at the constructor not passed in
  bytes32 public immutable RELAY_HASH;
  /// @notice target address for this relay ( this is the address that the action will be taken)
  address public immutable TARGET_ADDRESS;
  /// @notice human readable function signature that can be called with this relay
  string public TARGET_FUNCTION_SIGNATURE;

  /// @notice variables keeping track of votes for specific action. The bytes are data for the call. As in arguments passed in
  /// eg. if this relay was transfer() of a specific token, that token address would be in TARGET_ADDRESS
  /// function signature would be transfer, and this would be a bytes representation of "address,uint256" 
  /// Because the function transfer() in ERC20 is transfer(address,uint256)
  mapping (bytes => uint256) public yesVoteDelegates;
  /// @notice historical calls made by a person for specific bytes configuration
  /// @dev this contract is designed to retain as much historical data as possible for transparency
  mapping (bytes => mapping(uint256 => mapping(address=> bool))) public votesForExecution;
  /// @dev increases each time excution is called after proper maturation and execution que
  /// Note that this will trigger and reset the votes if the rules upstream change (the vote count needed)
  /// This is done on purpose
  mapping (bytes => uint256) public executionAttemptCount; 
  /// @notice user friendly name for this relay to be read by bots and front end interfaces
  /// @dev started with a _ to appear first on etherscan, again for transparency
  string public _humanReadableName;
  /// @dev this variable keeps track of the time consensus was achieved and a execution was queued up, waiting to mature and be executable on master contract
  mapping (bytes => uint256) public consensusWithMaturation;
  IDELTAMultiSignature public immutable DELTA_MULTISIGNATURE;

  uint256 internal contractStartTimestamp;
  mapping (bytes => mapping(uint256 => address [])) public voters;

  constructor(uint256 minimumDelay, uint256 maturedDelay, uint256 maturingTime, uint256 gracePeriod, address targetAddress, string memory targetFunctionSignature, string memory humanReadableName) public {
    require(maturedDelay > minimumDelay, "Maximum delay needs to be bigger than minimum delay");
    require(maturingTime > 0, "Maturing time need to be bigger than zero");
    require(targetAddress != address(this), "Wrong target address");
    MINIMUM_DELAY_SECONDS = minimumDelay;
    MATURED_MAXIMUM_DELAY_SECONDS = maturedDelay;
    MATURING_TIME_DAYS = maturingTime;
    GRACE_PERIOD_HOURS = gracePeriod;
    TARGET_ADDRESS = targetAddress;
    TARGET_FUNCTION_SIGNATURE = targetFunctionSignature;
    DELTA_MULTISIGNATURE = IDELTAMultiSignature(msg.sender);
    RELAY_HASH = bytes32(keccak256(abi.encodePacked(targetAddress,targetFunctionSignature)));
    _humanReadableName = humanReadableName;
    contractStartTimestamp = block.timestamp;
  }

  receive()  external payable {
      revert("No eth pls");
  }


  /// @notice function that executes specific set of instructions to the function this relay is reponsible for
  /// @dev This function checks if requirements for execution are met from upstream contract
  function queueExecution(bytes memory functionArguments) public {
    /// @dev we call the master contract to get the multisignator
    require(DELTA_MULTISIGNATURE.isActiveMultiSignator(msg.sender), "Invalid caller");
    require(hasEnoughVotesToExecute(functionArguments), "Didn't achieve consensus");
    require(consensusWithMaturation[functionArguments] == 0, "Function with the exact arguments already queued");
    

    /// @dev We queue execution of this
    consensusWithMaturation[functionArguments] = block.timestamp + currentMaturationTime();
    emit ExecutionMaturationStarted(msg.sender, functionArguments, block.timestamp);

  }

  /// @notice this is the inverse of queue exectuion function. It dequeues the execution in case the requirements changed upstream
  function unqueueExecution(bytes memory functionArguments) public {
    /// @dev we call the master contract to get the multisignator
    (,,bool isActive) = DELTA_MULTISIGNATURE.multisignatorInfo(msg.sender);
    require(isActive, "Bad calller");
    require(hasEnoughVotesToExecute(functionArguments) == false, "Execution consensus is still achieved");
    consensusWithMaturation[functionArguments] = 0;
    emit ExecutionCancelled(msg.sender, functionArguments, block.timestamp);
  }

  /// @dev loops over all votes for the execution and counts number of delegates against needed delegates from upstream contract
  function hasEnoughVotesToExecute(bytes memory functionArguments) public view returns (bool) {
      /// Count all votes
      uint256 executionNumber = executionAttemptCount[functionArguments];
      uint256 totalVotes;
      uint256 votesNeeded = DELTA_MULTISIGNATURE.numberOfDelegatesNeeded(TARGET_ADDRESS, TARGET_FUNCTION_SIGNATURE);
     
      /// @dev we loop over all valid voters and check how many delegates there are
      for(uint256 i = 0; i < voters[functionArguments][executionNumber].length; i++) {
         address currentVoter = voters[functionArguments][executionNumber][i];
        (uint256 delegateCount,,bool isActive) = DELTA_MULTISIGNATURE.multisignatorInfo(currentVoter);
        if(isActive) {
            totalVotes = totalVotes.add(delegateCount); 
        }
      }

      return totalVotes >= votesNeeded;
  }


  /// @dev Vote for execution, votes are yes or no, we add them to total votes as is. 
  /// Votes can be changed by calling this function again
  /// Cannot vote more than once for the same function execution (with same arguments)
  function voteForExecution(bytes memory functionArguments) public {
      /// @dev we call the master contract to get the multisignator
      (uint256 delegateCount,,bool isActive) = DELTA_MULTISIGNATURE.multisignatorInfo(msg.sender);
      require(isActive && delegateCount > 0, "Invalid caller");

      // Check if this person already voted yes.
      uint256 executionNumber = executionAttemptCount[functionArguments];
      votesForExecution[functionArguments][executionNumber][msg.sender] = true;

      bool alreadyVoted;
      /// @dev we check if the person already voted, if not we push it later ( loop over all votes)
      /// Voters is used to loop over, so we bear the cost of loops on the voter instead of the executor, so its not abusable
      for(uint256 i = 0; i < voters[functionArguments][executionNumber].length; i++) {
          if(voters[functionArguments][executionNumber][i] == msg.sender) {
              alreadyVoted = true;
              break;
          }
      }

      if(alreadyVoted == false) {
          voters[functionArguments][executionNumber].push(msg.sender);
          emit YesVoteCast(msg.sender, functionArguments, block.timestamp);
      }
  }

  function cancelVote(bytes memory functionArguments) public {
      /// @dev we call the master contract to get the multisignator
      (,,bool isActive) = DELTA_MULTISIGNATURE.multisignatorInfo(msg.sender);
      require(isActive, "Invalid caller");
      uint256 executionNumber = executionAttemptCount[functionArguments];
      votesForExecution[functionArguments][executionNumber][msg.sender] = false;
      emit VoteCancelled(msg.sender, functionArguments, block.timestamp);
  }


  /// @notice maturation time is linearly increasing from minimum to max within the maturation timeframe
  function currentMaturationTime() public view returns (uint256) {
    /// @dev grace period is in hours
    /// @notice Grace period delay is 0
    uint256 gracePeriod = GRACE_PERIOD_HOURS * 1 hours;
    /// @dev our maturation starts just after grace period begins
    uint256 timeStampGracePeriodOver = contractStartTimestamp + gracePeriod;

    if(block.timestamp <= timeStampGracePeriodOver) {
      return 0;
    }
    /// @dev otherwise we use the linear function
    uint256 timeSinceGracePeriodEnded = block.timestamp - timeStampGracePeriodOver;
    uint256 maturationTimeToReachMax = MATURING_TIME_DAYS * 1 days;

    uint256 percentMatured = timeSinceGracePeriodEnded.mul(100).div(maturationTimeToReachMax);
    if(percentMatured > 100) { return MATURED_MAXIMUM_DELAY_SECONDS; }
    
    /// @dev matured max is always bigger because of constructor check
    uint256 maturationDifference = MATURED_MAXIMUM_DELAY_SECONDS - MINIMUM_DELAY_SECONDS;
 
    // Returns the seconds between the minimum and maximum delay based on the
    // maturation percentage.
    return maturationDifference.mul(percentMatured).div(100);
  }

  /// @notice checks for validity of the execution and calls the multisig to execute the function hash
  /// @dev increments the executionCount for specific function arguments so we can't call something twice.
  /// @return resultData returns the return data for the call or bytes(0) if the call was not executed because of consensus mistmatch
  function execute(bytes memory functionArguments) public returns (bytes memory resultData) {
      /// @dev we call the master contract to get the multisignator
     (,,bool isActive) = DELTA_MULTISIGNATURE.multisignatorInfo(msg.sender);
     require(isActive, "Invalid caller");

      uint256 consensusTimestampMatured = consensusWithMaturation[functionArguments];
      require(consensusTimestampMatured > 0, "Consensus not reached");
      require(block.timestamp >= consensusTimestampMatured, "Maturation pending");

      /// @dev we check the consensus again in case something changed upstream (rules for conesnsus changed or more peopel were added)
      bool shouldExecute = hasEnoughVotesToExecute(functionArguments);
        
      /// @dev if rules upstream changed we bail here and remove all votes
      
      if(shouldExecute) {
        /// @dev we execute the function - note the multisig wil check this address and hash it
         resultData = DELTA_MULTISIGNATURE.execute(TARGET_ADDRESS, TARGET_FUNCTION_SIGNATURE, functionArguments);
      }  else {
         resultData = bytes(abi.encodePacked(uint256(0)));
      }
        
      /// @dev we up the execution count to nullify previous votes
      executionAttemptCount[functionArguments]++;
      /// @dev we reset the consensus timestamp so it cannot be callable again
      /// Note this cant be recalled by consensus even tho it will have votes because we up the execution count
      consensusWithMaturation[functionArguments] = 0; 
      
    
  }



}




  