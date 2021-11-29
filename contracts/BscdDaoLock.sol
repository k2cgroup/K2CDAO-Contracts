pragma solidity 0.5.16;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "./interfaces/IBscdCertifiableToken.sol";
import "./library/BasisPoints.sol";


contract BscdDaoLock is Initializable, Ownable {
    using BasisPoints for uint;
    using SafeMath for uint;

    uint public releaseInterval;
    uint public releaseStart;
    uint public releaseBP;

    uint public startingBscd;
    uint public claimedBscd;

    IBscdCertifiableToken private bscdToken;

    address internal daoWallet;

    modifier onlyAfterStart {
        require(releaseStart != 0 && now > releaseStart, "Has not yet started.");
        _;
    }

    function initialize(
        uint _releaseInterval,
        uint _releaseBP,
        address owner,
        IBscdCertifiableToken _bscdToken
    ) external initializer {
        releaseInterval = _releaseInterval;
        releaseBP = _releaseBP;
        bscdToken = _bscdToken;

        Ownable.initialize(msg.sender);

        //Due to issue in oz testing suite, the msg.sender might not be owner
        _transferOwnership(owner);
    }

    function() external payable { }

    function claimBscd() external onlyAfterStart {
        require(releaseStart != 0, "Has not yet started.");
        uint cycle = getCurrentCycleCount();
        uint totalClaimAmount = cycle.mul(startingBscd.mulBP(releaseBP));
        uint toClaim = totalClaimAmount.sub(claimedBscd);
        if (bscdToken.balanceOf(address(this)) < toClaim) toClaim = bscdToken.balanceOf(address(this));
        claimedBscd = claimedBscd.add(toClaim);
        bscdToken.transfer(daoWallet, toClaim);
    }

    function startRelease(address _daoWallet) external onlyOwner {
        require(releaseStart == 0, "Has already started.");
        require(bscdToken.balanceOf(address(this)) != 0, "Must have some bscd deposited.");
        daoWallet = _daoWallet;
        startingBscd = bscdToken.balanceOf(address(this));
        releaseStart = now.add(24 hours);
    }

    function getCurrentCycleCount() public view returns (uint) {
        if (now <= releaseStart) return 0;
        return now.sub(releaseStart).div(releaseInterval).add(1);
    }

}
