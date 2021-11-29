pragma solidity 0.5.16;
import "./bscswap/interfaces/IBSCswapRouter01.sol";
import "./interfaces/IXEth.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Pausable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "./bscswap/interfaces/IBSCswapPair.sol";
import "./library/BasisPoints.sol";
import "./interfaces/IBscdCertifiableToken.sol";
import "./BscdStaking.sol";
import "./BscdCertifiedPresale.sol";

contract BscdToken is
    Initializable,
    ERC20Burnable,
    ERC20Mintable,
    ERC20Pausable,
    ERC20Detailed,
    Ownable
{
    using BasisPoints for uint256;
    using SafeMath for uint256;

    uint256 public taxBP;
    uint256 public daoTaxBP;
    address private daoFund;
    BscdStaking private bscdStaking;
    BscdCertifiedPresale private bscdPresale;

    bool public isTaxActive;
    bool public isTransfersActive;

    mapping(address => bool) private trustedContracts;
    mapping(address => bool) public taxExempt;
    mapping(address => bool) public fromOnlyTaxExempt;
    mapping(address => bool) public toOnlyTaxExempt;

    string private _name;

    modifier onlyPresaleContract() {
        require(
            msg.sender == address(bscdPresale),
            "Can only be called by presale sc."
        );
        _;
    }

    function () external payable {}

    function initialize(
        string calldata name,
        string calldata symbol,
        uint8 decimals,
        address owner,
        uint256 _taxBP,
        uint256 _daoTaxBP,
        address _daoFund,
        BscdStaking _bscdStaking,
        BscdCertifiedPresale _bscdPresale
    ) external initializer {
        taxBP = _taxBP;
        daoTaxBP = _daoTaxBP;

        Ownable.initialize(msg.sender);

        ERC20Detailed.initialize(name, symbol, decimals);

        ERC20Mintable.initialize(address(this));
        _removeMinter(address(this));
        _addMinter(owner);

        ERC20Pausable.initialize(address(this));
        _removePauser(address(this));
        _addPauser(owner);

        daoFund = _daoFund;
        bscdStaking = _bscdStaking;
        addTrustedContract(address(_bscdStaking));
        addTrustedContract(address(_bscdPresale));
        setTaxExemptStatus(address(_bscdStaking), true);
        setTaxExemptStatus(address(_bscdPresale), true);
        //Due to issue in oz testing suite, the msg.sender might not be owner
        _transferOwnership(owner);
    }

    function refundToken(
        IERC20 token,
        address to,
        uint wad
    ) external onlyOwner {
        token.transfer(to,wad);
    }

    function setIsTaxActive(bool val) external onlyOwner {
        isTaxActive = val;
    }

    function setIsTransfersActive(bool val) external onlyOwner {
        isTransfersActive = val;
    }

    function xbnbLiqTransfer(
        IBSCswapRouter01 julswapRouter,
        address pair,
        IXEth xeth,
        uint256 minWadExpected
    ) external onlyOwner {
        isTaxActive = false;
        trustedContracts[address(julswapRouter)] = true;
        uint256 lidLiqWad = balanceOf(pair).sub(1 ether);
        _transfer(pair, address(this), lidLiqWad);
        IBSCswapPair(pair).sync();
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = julswapRouter.WBNB();
        julswapRouter.swapExactTokensForBNB(
            lidLiqWad,
            minWadExpected,
            path,
            address(this),
            now
        );
        _transfer(pair, address(this), lidLiqWad);
        IBSCswapPair(pair).sync();
        xeth.deposit.value(address(this).balance)();
        require(
            xeth.balanceOf(address(this)) >= minWadExpected,
            "Less xeth than expected."
        );

        xeth.approve(address(julswapRouter), uint256(-1));
        julswapRouter.addLiquidity(
            address(this),
            address(xeth),
            lidLiqWad,
            xeth.balanceOf(address(this)),
            lidLiqWad,
            xeth.balanceOf(address(this)),
            address(0x0),
            now
        );
        
        trustedContracts[address(julswapRouter)] = false;
        isTaxActive = true;
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function transfer(address recipient, uint256 amount) public returns (bool) {
        require(isTransfersActive, "Transfers are currently locked.");
        (isTaxActive &&
            !taxExempt[msg.sender] &&
            !taxExempt[recipient] &&
            !toOnlyTaxExempt[recipient] &&
            !fromOnlyTaxExempt[msg.sender])
            ? _transferWithTax(msg.sender, recipient, amount)
            : _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public returns (bool) {
        require(isTransfersActive, "Transfers are currently locked.");
        (isTaxActive &&
            !taxExempt[sender] &&
            !taxExempt[recipient] &&
            !toOnlyTaxExempt[recipient] &&
            !fromOnlyTaxExempt[sender])
            ? _transferWithTax(sender, recipient, amount)
            : _transfer(sender, recipient, amount);
        if (trustedContracts[msg.sender]) return true;
        approve(
            msg.sender,
            allowance(sender, msg.sender).sub(
                amount,
                "Transfer amount exceeds allowance"
            )
        );
        return true;
    }

    function addTrustedContract(address contractAddress) public onlyOwner {
        trustedContracts[contractAddress] = true;
    }

    function setTaxExemptStatus(address account, bool status) public onlyOwner {
        taxExempt[account] = status;
    }

    function findTaxAmount(uint256 value)
        public
        view
        returns (uint256 tax, uint256 daoTax)
    {
        tax = value.mulBP(taxBP);
        daoTax = value.mulBP(daoTaxBP);
    }

    function _transferWithTax(
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        (uint256 tax, uint256 daoTax) = findTaxAmount(amount);
        uint256 tokensToTransfer = amount.sub(tax).sub(daoTax);

        _transfer(sender, address(bscdStaking), tax);
        _transfer(sender, address(daoFund), daoTax);
        _transfer(sender, recipient, tokensToTransfer);
        bscdStaking.handleTaxDistribution(tax);
    }
}
