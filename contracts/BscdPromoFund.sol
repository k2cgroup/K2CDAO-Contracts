pragma solidity 0.5.16;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "./interfaces/IBscdCertifiableToken.sol";

contract BscdPromoFund is Initializable {
    using SafeMath for uint256;

    IBscdCertifiableToken private bscdToken;
    address public authorizor;
    address public releaser;

    uint256 public totalBscdAuthorized;
    uint256 public totalBscdReleased;

    uint256 public totalEthAuthorized;
    uint256 public totalEthReleased;

    mapping(address => bool) authorizors;

    mapping(address => bool) releasers;

    function initialize(
        address _authorizor,
        address _releaser,
        IBscdCertifiableToken _bscdToken
    ) external initializer {
        bscdToken = _bscdToken;
        authorizor = _authorizor;
        releaser = _releaser;
    }

    function() external payable {}

    function releaseBscdToAddress(address receiver, uint256 amount) external {
        require(msg.sender == authorizor, "Can only be called by authorizor.");
        bscdToken.transfer(receiver, amount);
    }

    function releaseEthToAddress(address payable receiver, uint256 amount)
        external
    {
        require(msg.sender == authorizor, "Can only be called by authorizor.");
        receiver.transfer(amount);
    }
}
