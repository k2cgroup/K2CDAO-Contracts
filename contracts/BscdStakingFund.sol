pragma solidity 0.5.16;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "./interfaces/IBscdCertifiableToken.sol";


contract BscdStakingFund is Initializable {
    using SafeMath for uint;

    IBscdCertifiableToken private bscdToken;
    address public authorizor;
    address public releaser;

    uint public totalBscdAuthorized;
    uint public totalBscdReleased;

    function initialize(
        address _authorizor,
        address _releaser,
        IBscdCertifiableToken _bscdToken
    ) external initializer {
        bscdToken = _bscdToken;
        authorizor = _authorizor;
        releaser = _releaser;
    }

    function() external payable { }

    function releaseBscdToAddress(address receiver, uint amount) external {
        require(msg.sender == releaser, "Can only be called releaser.");
        require(amount <= totalBscdAuthorized.sub(totalBscdReleased), "Cannot release more Bscd than available.");
        totalBscdReleased = totalBscdReleased.add(amount);
        bscdToken.transfer(receiver, amount);
    }

    function authorizeBscd(uint amount) external {
        require(msg.sender == authorizor, "Can only be called authorizor.");
        totalBscdAuthorized = totalBscdAuthorized.add(amount);
    }
}
