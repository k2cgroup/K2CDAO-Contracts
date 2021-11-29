pragma solidity 0.5.16;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "./BscdStaking.sol";
import "./BscdToken.sol";

contract BscdVotingRights is Initializable {

  BscdStaking public bscdStaking;
  BscdToken public bscdToken;

  function initialize(
    BscdStaking _bscdStaking,
    BscdToken _bscdToken
  ) external initializer {
    bscdStaking = _bscdStaking;
    bscdToken = _bscdToken;
  }

  function name() public pure returns (string memory) {
    return "BSCD Voting Rights";
  }

  function symbol() public pure returns (string memory) {
    return "BSCD-VR";
  }

  function decimals() public view returns (uint8) {
    return bscdToken.decimals();
  }

  function balanceOf(address _owner) public view returns (uint) {
    return bscdStaking.stakeValue(_owner);
  }

  function totalSupply() public view returns (uint) {
    return bscdStaking.totalStaked();
  }

  function balanceOfAt(address _owner, uint _blockNumber) public view returns (uint) {
    return bscdStaking.stakeValueAt(_owner, _blockNumber);
  }

  function totalSupplyAt(uint _blockNumber) public view returns (uint) {
    return bscdStaking.totalStakedAt(_blockNumber);
  }
}
