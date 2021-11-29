pragma solidity 0.5.16;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "./bscswap/interfaces/IBSCswapRouter01.sol";
import "./library/BasisPoints.sol";
import "./interfaces/IBscdCertifiableToken.sol";
import "./BscdCertifiedPresaleTimer.sol";


contract BscdCertifiedPresale is Initializable, Ownable, ReentrancyGuard {
    using BasisPoints for uint;
    using SafeMath for uint;

    uint public maxBuyPerAddressBase;
    uint public maxBuyPerAddressBP;
    uint public maxBuyWithoutWhitelisting;

    uint public redeemBP;
    uint public redeemInterval;

    uint public referralBP;

    uint public julswapBNBBP;
    address payable[] public etherPools;
    uint[] public etherPoolBPs;

    uint public uniswapTokenBP;
    uint public presaleTokenBP;
    address[] public tokenPools;
    uint[] public tokenPoolBPs;

    uint public startingPrice;
    uint public multiplierPrice;

    bool public hasSentToJulswap;
    bool public hasIssuedTokens;
    bool public hasSentEther;

    uint public totalTokens;
    uint private totalEth;
    uint public finalEndTime;

    IBscdCertifiableToken private token;
    IBSCswapRouter01 private julswapRouter;
    BscdCertifiedPresaleTimer private timer;

    mapping(address => uint) public depositAccounts;
    mapping(address => uint) public accountEarnedBscd;
    mapping(address => uint) public accountClaimedBscd;
    mapping(address => bool) public whitelist;
    mapping(address => uint) public earnedReferrals;

    uint public totalDepositors;
    mapping(address => uint) public referralCounts;

    uint public lidRepaired;
    bool public pauseDeposit;

    mapping(address => bool) public isRepaired;

    modifier whenPresaleActive {
        require(timer.isStarted(), "Presale not yet started.");
        require(!_isPresaleEnded(), "Presale has ended.");
        _;
    }

    modifier whenPresaleFinished {
        require(timer.isStarted(), "Presale not yet started.");
        require(_isPresaleEnded(), "Presale has not yet ended.");
        _;
    }

    function initialize(
        uint _maxBuyPerAddressBase,
        uint _maxBuyPerAddressBP,
        uint _maxBuyWithoutWhitelisting,
        uint _redeemBP,
        uint _redeemInterval,
        uint _referralBP,
        uint _startingPrice,
        uint _multiplierPrice,
        address owner,
        BscdCertifiedPresaleTimer _timer,
        IBscdCertifiableToken _token
    ) external initializer {
        require(_token.isMinter(address(this)), "Presale SC must be minter.");
        Ownable.initialize(msg.sender);
        ReentrancyGuard.initialize();

        token = _token;
        timer = _timer;

        maxBuyPerAddressBase = _maxBuyPerAddressBase;
        maxBuyPerAddressBP = _maxBuyPerAddressBP;
        maxBuyWithoutWhitelisting = _maxBuyWithoutWhitelisting;

        redeemBP = _redeemBP;

        referralBP = _referralBP;
        redeemInterval = _redeemInterval;

        startingPrice = _startingPrice;
        multiplierPrice = _multiplierPrice;

        julswapRouter = IBSCswapRouter01(0xbd67d157502A23309Db761c41965600c2Ec788b2);

        //Due to issue in oz testing suite, the msg.sender might not be owner
        _transferOwnership(owner);
    }

    function deposit() external payable {
        deposit(address(0x0));
    }

    function setEtherPools(
        address payable[] calldata _etherPools,
        uint[] calldata _etherPoolBPs
    ) external onlyOwner {
        require(_etherPools.length == _etherPoolBPs.length, "Must have exactly one etherPool addresses for each BP.");
        delete etherPools;
        delete etherPoolBPs;
        julswapBNBBP = 7500; //75%
        for (uint i = 0; i < _etherPools.length; ++i) {
            etherPools.push(_etherPools[i]);
        }
        uint totalEtherPoolsBP = julswapBNBBP;
        for (uint i = 0; i < _etherPoolBPs.length; ++i) {
            etherPoolBPs.push(_etherPoolBPs[i]);
            totalEtherPoolsBP = totalEtherPoolsBP.add(_etherPoolBPs[i]);
        }
        require(totalEtherPoolsBP == 10000, "Must allocate exactly 100% (10000 BP) of ether to pools");
    }

    function setTokenPools(
        address[] calldata _tokenPools,
        uint[] calldata _tokenPoolBPs
    ) external onlyOwner {
        require(_tokenPools.length == _tokenPoolBPs.length, "Must have exactly one tokenPool addresses for each BP.");
        delete tokenPools;
        delete tokenPoolBPs;
        uniswapTokenBP = 1600;
        presaleTokenBP = 4000;
        for (uint i = 0; i < _tokenPools.length; ++i) {
            tokenPools.push(_tokenPools[i]);
        }
        uint totalTokenPoolBPs = uniswapTokenBP.add(presaleTokenBP);
        for (uint i = 0; i < _tokenPoolBPs.length; ++i) {
            tokenPoolBPs.push(_tokenPoolBPs[i]);
            totalTokenPoolBPs = totalTokenPoolBPs.add(_tokenPoolBPs[i]);
        }
        require(totalTokenPoolBPs == 10000, "Must allocate exactly 100% (10000 BP) of tokens to pools");
    }

    function sendToJulswap() external whenPresaleFinished nonReentrant {
        require(etherPools.length > 0, "Must have set ether pools");
        require(tokenPools.length > 0, "Must have set token pools");
        require(!hasSentToJulswap, "Has already sent to Uniswap.");
        finalEndTime = now;
        hasSentToJulswap = true;
        totalTokens = totalTokens.divBP(presaleTokenBP);
        uint julswapTokens = totalTokens.mulBP(uniswapTokenBP);
        totalEth = address(this).balance;
        uint julswapBNB = totalEth.mulBP(julswapBNBBP);
        token.mint(address(this), julswapTokens);
        token.activateTransfers();
        token.approve(address(julswapRouter), julswapTokens);
        julswapRouter.addLiquidityBNB.value(julswapBNB)(
            address(token),
            julswapTokens,
            julswapTokens,
            julswapBNB,
            address(0x000000000000000000000000000000000000dEaD),
            now
        );
    }

    function issueTokens() external whenPresaleFinished {
        require(hasSentToJulswap, "Has not yet sent to Uniswap.");
        require(!hasIssuedTokens, "Has already issued tokens.");
        hasIssuedTokens = true;
        for (uint i = 0; i < tokenPools.length; ++i) {
            token.mint(
                tokenPools[i],
                totalTokens.mulBP(tokenPoolBPs[i])
            );
        }
    }

    function sendEther() external whenPresaleFinished nonReentrant {
        require(hasSentToJulswap, "Has not yet sent to Uniswap.");
        require(!hasSentEther, "Has already sent ether.");
        hasSentEther = true;
        for (uint i = 0; i < etherPools.length; ++i) {
            etherPools[i].transfer(
                totalEth.mulBP(etherPoolBPs[i])
            );
        }
        //remove dust
        if (address(this).balance > 0) {
            etherPools[0].transfer(
                address(this).balance
            );
        }
    }

    function emergencyEthWithdrawl() external whenPresaleFinished nonReentrant onlyOwner {
        require(hasSentToJulswap, "Has not yet sent to Uniswap.");
        msg.sender.transfer(address(this).balance);
    }

    function setDepositPause(bool val) external onlyOwner {
        pauseDeposit = val;
    }

    function setWhitelist(address account, bool value) external onlyOwner {
        whitelist[account] = value;
    }

    function setWhitelistForAll(address[] calldata account, bool value) external onlyOwner {
        for (uint i=0; i < account.length; i++) {
            whitelist[account[i]] = value;
        }
    }

    function redeem() external whenPresaleFinished {
        require(hasSentToJulswap, "Must have sent to Uniswap before any redeems.");
        uint claimable = calculateReedemable(msg.sender);
        accountClaimedBscd[msg.sender] = accountClaimedBscd[msg.sender].add(claimable);
        token.mint(msg.sender, claimable);
    }

    function deposit(address payable referrer) public payable whenPresaleActive nonReentrant {
        require(!pauseDeposit, "Deposits are paused.");
        if (whitelist[msg.sender]) {
            require(
                depositAccounts[msg.sender].add(msg.value) <=
                getMaxWhitelistedDeposit(
                    address(this).balance.sub(msg.value)
                ),
                "Deposit exceeds max buy per address for whitelisted addresses."
            );
        } else {
            require(
                depositAccounts[msg.sender].add(msg.value) <= maxBuyWithoutWhitelisting,
                "Deposit exceeds max buy per address for non-whitelisted addresses."
            );
        }

        require(msg.value > 0.01 ether, "Must purchase at least 0.01 ether.");

        if (depositAccounts[msg.sender] == 0) totalDepositors = totalDepositors.add(1);

        uint depositVal = msg.value.subBP(referralBP);
        uint tokensToIssue = depositVal.mul(10**18).div(calculateRatePerEth());
        depositAccounts[msg.sender] = depositAccounts[msg.sender].add(depositVal);

        totalTokens = totalTokens.add(tokensToIssue);

        accountEarnedBscd[msg.sender] = accountEarnedBscd[msg.sender].add(tokensToIssue);

        if (referrer != address(0x0) && referrer != msg.sender) {
            uint referralValue = msg.value.sub(depositVal);
            earnedReferrals[referrer] = earnedReferrals[referrer].add(referralValue);
            referralCounts[referrer] = referralCounts[referrer].add(1);
            referrer.transfer(referralValue);
        }
    }

    function calculateReedemable(address account) public view returns (uint) {
        if (finalEndTime == 0) return 0;
        uint earnedBscd = accountEarnedBscd[account];
        uint claimedBscd = accountClaimedBscd[account];
        uint cycles = now.sub(finalEndTime).div(redeemInterval).add(1);
        uint totalRedeemable = earnedBscd.mulBP(redeemBP).mul(cycles);
        uint claimable;
        if (totalRedeemable >= earnedBscd) {
            claimable = earnedBscd.sub(claimedBscd);
        } else {
            claimable = totalRedeemable.sub(claimedBscd);
        }
        return claimable;
    }

    function calculateRatePerEth() public view returns (uint) {
        return totalTokens.div(10**18).mul(multiplierPrice).add(startingPrice);
    }

    function getMaxWhitelistedDeposit(uint atTotalDeposited) public view returns (uint) {
        return atTotalDeposited.mulBP(maxBuyPerAddressBP).add(maxBuyPerAddressBase);
    }

    function _isPresaleEnded() internal view returns (bool) {
        return (
            (timer.isStarted() && (now > timer.getEndTime(address(this).balance)))
        );
    }

}
