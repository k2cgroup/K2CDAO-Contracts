pragma solidity 0.5.16;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "./library/BasisPoints.sol";
import "./interfaces/IStakeHandler.sol";
import "./interfaces/IBscdCertifiableToken.sol";


contract BscdStaking is Initializable, Ownable {
    using BasisPoints for uint;
    using SafeMath for uint;

    uint256 constant internal DISTRIBUTION_MULTIPLIER = 2 ** 64;

    uint public stakingTaxBP;
    uint public unstakingTaxBP;
    IBscdCertifiableToken private bscdToken;

    mapping(address => uint) public stakeValue;
    mapping(address => int) public stakerPayouts;


    uint public totalDistributions;
    uint public totalStaked;
    uint public totalStakers;
    uint public profitPerShare;
    uint private emptyStakeTokens; //These are tokens given to the contract when there are no stakers.

    IStakeHandler[] public stakeHandlers;
    uint public startTime;

    uint public registrationFeeWithReferrer;
    uint public registrationFeeWithoutReferrer;
    mapping(address => uint) public accountReferrals;
    mapping(address => bool) public stakerIsRegistered;

    event OnDistribute(address sender, uint amountSent);
    event OnStake(address sender, uint amount, uint tax);
    event OnUnstake(address sender, uint amount, uint tax);
    event OnReinvest(address sender, uint amount, uint tax);
    event OnWithdraw(address sender, uint amount);

    bool private initialized;

    struct Checkpoint {
      uint128 fromBlock;
      uint128 value;
    }

    mapping(address => Checkpoint[]) internal stakeValueHistory;

    Checkpoint[] internal totalStakedHistory;

    modifier v2Initializer() {
        require(!initialized, "V2 Contract instance has already been initialized");
        initialized = true;
        _;
    }

    modifier onlyBscdToken {
        require(msg.sender == address(bscdToken), "Can only be called by BscdToken contract.");
        _;
    }

    modifier whenStakingActive {
        require(startTime != 0 && now > startTime, "Staking not yet started.");
        _;
    }

    function initialize(
        uint _stakingTaxBP,
        uint _ustakingTaxBP,
        uint _registrationFeeWithReferrer,
        uint _registrationFeeWithoutReferrer,
        address owner,
        IBscdCertifiableToken _bscdToken
    ) external initializer {
        Ownable.initialize(msg.sender);
        stakingTaxBP = _stakingTaxBP;
        unstakingTaxBP = _ustakingTaxBP;
        bscdToken = _bscdToken;
        registrationFeeWithReferrer = _registrationFeeWithReferrer;
        registrationFeeWithoutReferrer = _registrationFeeWithoutReferrer;
        //Due to issue in oz testing suite, the msg.sender might not be owner
        _transferOwnership(owner);
    }

    function v2Initialize(
        IBscdCertifiableToken _bscdToken
    ) external v2Initializer onlyOwner {
        bscdToken = _bscdToken;
    }

    function registerAndStake(uint amount) public {
        registerAndStake(amount, address(0x0));
    }

    function registerAndStake(uint amount, address referrer) public whenStakingActive {
        require(!stakerIsRegistered[msg.sender], "Staker must not be registered");
        require(bscdToken.balanceOf(msg.sender) >= amount, "Must have enough balance to stake amount");
        uint finalAmount;
        if(address(0x0) == referrer) {
            //No referrer
            require(amount >= registrationFeeWithoutReferrer, "Must send at least enough LID to pay registration fee.");
            distribute(registrationFeeWithoutReferrer);
            finalAmount = amount.sub(registrationFeeWithoutReferrer);
        } else {
            //has referrer
            require(amount >= registrationFeeWithReferrer, "Must send at least enough LID to pay registration fee.");
            require(bscdToken.transferFrom(msg.sender, referrer, registrationFeeWithReferrer), "Stake failed due to failed referral transfer.");
            accountReferrals[referrer] = accountReferrals[referrer].add(1);
            finalAmount = amount.sub(registrationFeeWithReferrer);
        }
        stakerIsRegistered[msg.sender] = true;
        stake(finalAmount);
    }

    function stake(uint amount) public whenStakingActive {
        require(stakerIsRegistered[msg.sender] == true, "Must be registered to stake.");
        require(amount >= 1e18, "Must stake at least one LID.");
        require(bscdToken.balanceOf(msg.sender) >= amount, "Cannot stake more LID than you hold unstaked.");
        if (stakeValue[msg.sender] == 0) totalStakers = totalStakers.add(1);
        uint tax = _addStake(amount);
        require(bscdToken.transferFrom(msg.sender, address(this), amount), "Stake failed due to failed transfer.");
        emit OnStake(msg.sender, amount, tax);
    }

    function unstake(uint amount) external whenStakingActive {
        require(amount >= 1e18, "Must unstake at least one LID.");
        require(stakeValue[msg.sender] >= amount, "Cannot unstake more LID than you have staked.");
        // Update staker's history
        _updateCheckpointValueAtNow(
        stakeValueHistory[msg.sender],
        stakeValue[msg.sender],
        stakeValue[msg.sender].sub(amount)
        );

        // Update total staked history
        _updateCheckpointValueAtNow(
        totalStakedHistory,
        totalStaked,
        totalStaked.sub(amount)
        );
        
        //must withdraw all dividends, to prevent overflows
        withdraw(dividendsOf(msg.sender));
        if (stakeValue[msg.sender] == amount) totalStakers = totalStakers.sub(1);
        totalStaked = totalStaked.sub(amount);
        stakeValue[msg.sender] = stakeValue[msg.sender].sub(amount);

        uint tax = findTaxAmount(amount, unstakingTaxBP);
        uint earnings = amount.sub(tax);
        _increaseProfitPerShare(tax);
        stakerPayouts[msg.sender] = uintToInt(profitPerShare.mul(stakeValue[msg.sender]));

        for (uint i=0; i < stakeHandlers.length; i++) {
            stakeHandlers[i].handleUnstake(msg.sender, amount, stakeValue[msg.sender]);
        }
        
        require(bscdToken.transferFrom(address(this), msg.sender, earnings), "Unstake failed due to failed transfer.");
        emit OnUnstake(msg.sender, amount, tax);
    }

    function withdraw(uint amount) public whenStakingActive {
        require(dividendsOf(msg.sender) >= amount, "Cannot withdraw more dividends than you have earned.");
        stakerPayouts[msg.sender] = stakerPayouts[msg.sender] + uintToInt(amount.mul(DISTRIBUTION_MULTIPLIER));
        bscdToken.transfer(msg.sender, amount);
        emit OnWithdraw(msg.sender, amount);
    }

    function reinvest(uint amount) external whenStakingActive {
        require(dividendsOf(msg.sender) >= amount, "Cannot reinvest more dividends than you have earned.");
        uint payout = amount.mul(DISTRIBUTION_MULTIPLIER);
        stakerPayouts[msg.sender] = stakerPayouts[msg.sender] + uintToInt(payout);
        uint tax = _addStake(amount);
        emit OnReinvest(msg.sender, amount, tax);
    }

    function distribute(uint amount) public {
        require(bscdToken.balanceOf(msg.sender) >= amount, "Cannot distribute more LID than you hold unstaked.");
        totalDistributions = totalDistributions.add(amount);
        _increaseProfitPerShare(amount);
        require(
            bscdToken.transferFrom(msg.sender, address(this), amount),
            "Distribution failed due to failed transfer."
        );
        emit OnDistribute(msg.sender, amount);
    }

    function handleTaxDistribution(uint amount) external onlyBscdToken {
        totalDistributions = totalDistributions.add(amount);
        _increaseProfitPerShare(amount);
        emit OnDistribute(msg.sender, amount);
    }

    function dividendsOf(address staker) public view returns (uint) {
        int divPayout = uintToInt(profitPerShare.mul(stakeValue[staker]));
        require(divPayout >= stakerPayouts[staker], "dividend calc overflow");
        return uint(divPayout - stakerPayouts[staker])
            .div(DISTRIBUTION_MULTIPLIER);
    }

    function findTaxAmount(uint value, uint taxBP) public pure returns (uint) {
        return value.mulBP(taxBP);
    }

    function numberStakeHandlersRegistered() external view returns (uint) {
        return stakeHandlers.length;
    }

    function registerStakeHandler(IStakeHandler sc) external onlyOwner {
        stakeHandlers.push(sc);
    }

    function unregisterStakeHandler(uint index) external onlyOwner {
        IStakeHandler sc = stakeHandlers[stakeHandlers.length-1];
        stakeHandlers.pop();
        stakeHandlers[index] = sc;
    }

    function setStakingBP(uint valueBP) external onlyOwner {
        require(valueBP < 10000, "Tax connot be over 100% (10000 BP)");
        stakingTaxBP = valueBP;
    }

    function setUnstakingBP(uint valueBP) external onlyOwner {
        require(valueBP < 10000, "Tax connot be over 100% (10000 BP)");
        unstakingTaxBP = valueBP;
    }

    function setStartTime(uint _startTime) external onlyOwner {
        startTime = _startTime;
    }

    function totalStakedAt(uint _blockNumber) public view returns(uint) {
        // If we haven't initialized history yet
        if (totalStakedHistory.length == 0) {
        // Use the existing value
        return totalStaked;
        } else {
        // Binary search history for the proper staked amount
        return _getCheckpointValueAt(
            totalStakedHistory,
            _blockNumber
        );
        }
    }

    function stakeValueAt(address _owner, uint _blockNumber) public view returns (uint) {
        // If we haven't initialized history yet
        if (stakeValueHistory[_owner].length == 0) {
        // Use the existing latest value
        return stakeValue[_owner];
        } else {
        // Binary search history for the proper staked amount
        return _getCheckpointValueAt(stakeValueHistory[_owner], _blockNumber);
        }
    }

    function setRegistrationFees(uint valueWithReferrer, uint valueWithoutReferrer) external onlyOwner {
        registrationFeeWithReferrer = valueWithReferrer;
        registrationFeeWithoutReferrer = valueWithoutReferrer;
    }

    function uintToInt(uint val) internal pure returns (int) {
        if (val >= uint(-1).div(2)) {
            require(false, "Overflow. Cannot convert uint to int.");
        } else {
            return int(val);
        }
    }

    function _addStake(uint _amount) internal returns (uint tax) {
        tax = findTaxAmount(_amount, stakingTaxBP);
        uint stakeAmount = _amount.sub(tax);

        // Update staker's history
        _updateCheckpointValueAtNow(
        stakeValueHistory[msg.sender],
        stakeValue[msg.sender],
        stakeValue[msg.sender].add(stakeAmount)
        );

        // Update total staked history
        _updateCheckpointValueAtNow(
        totalStakedHistory,
        totalStaked,
        totalStaked.add(stakeAmount)
        );

        totalStaked = totalStaked.add(stakeAmount);
        stakeValue[msg.sender] = stakeValue[msg.sender].add(stakeAmount);
        for (uint i=0; i < stakeHandlers.length; i++) {
            stakeHandlers[i].handleStake(msg.sender, stakeAmount, stakeValue[msg.sender]);
        }
        uint payout = profitPerShare.mul(stakeAmount);
        stakerPayouts[msg.sender] = stakerPayouts[msg.sender] + uintToInt(payout);
        _increaseProfitPerShare(tax);
    }

    function _increaseProfitPerShare(uint amount) internal {
        if (totalStaked != 0) {
            if (emptyStakeTokens != 0) {
                amount = amount.add(emptyStakeTokens);
                emptyStakeTokens = 0;
            }
            profitPerShare = profitPerShare.add(amount.mul(DISTRIBUTION_MULTIPLIER).div(totalStaked));
        } else {
            emptyStakeTokens = emptyStakeTokens.add(amount);
        }
    }

    function _getCheckpointValueAt(Checkpoint[] storage checkpoints, uint _block) view internal returns (uint) {
    // This case should be handled by caller
    if (checkpoints.length == 0)
      return 0;

    // Use the latest checkpoint
    if (_block >= checkpoints[checkpoints.length-1].fromBlock)
      return checkpoints[checkpoints.length-1].value;

    // Use the oldest checkpoint
    if (_block < checkpoints[0].fromBlock)
      return checkpoints[0].value;

    // Binary search of the value in the array
    uint min = 0;
    uint max = checkpoints.length-1;
    while (max > min) {
      uint mid = (max + min + 1) / 2;
      if (checkpoints[mid].fromBlock<=_block) {
        min = mid;
      } else {
        max = mid-1;
      }
    }
    return checkpoints[min].value;
  }

  function _updateCheckpointValueAtNow(
    Checkpoint[] storage checkpoints,
    uint _oldValue,
    uint _value
  ) internal {
    require(_value <= uint128(-1));
    require(_oldValue <= uint128(-1));

    if (checkpoints.length == 0) {
      Checkpoint storage genesis = checkpoints[checkpoints.length++];
      genesis.fromBlock = uint128(block.number - 1);
      genesis.value = uint128(_oldValue);
    }

    if (checkpoints[checkpoints.length - 1].fromBlock < block.number) {
      Checkpoint storage newCheckPoint = checkpoints[checkpoints.length++];
      newCheckPoint.fromBlock = uint128(block.number);
      newCheckPoint.value = uint128(_value);
    } else {
      Checkpoint storage oldCheckPoint = checkpoints[checkpoints.length - 1];
      oldCheckPoint.value = uint128(_value);
    }
  }

}
