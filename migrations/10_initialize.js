const { scripts, ConfigManager } = require("@openzeppelin/cli")
const { add, push, create } = scripts
const { publicKey } = require("../privatekey")

const config = require("../config")

const BscdToken = artifacts.require("BscdToken")
const BscdTeamLock = artifacts.require("BscdTeamLock")
const BscdStakingFund = artifacts.require("BscdStakingFund")
const BscdStaking = artifacts.require("BscdStaking")
const BscdPromoFund = artifacts.require("BscdPromoFund")
const BscdDaoLock = artifacts.require("BscdDaoLock")
const BscdCertifiedPresaleTimer = artifacts.require("BscdCertifiedPresaleTimer")
const BscdCertifiedPresale = artifacts.require("BscdCertifiedPresale")

async function initialize(accounts, networkName) {
  let owner = accounts[0]

  const tokenParams = config.BscdToken
  const teamlockParams = config.BscdTeamLock
  const stakingFundParams = config.BscdStakingFund
  const stakingParams = config.BscdStaking
  const promoParams = config.BscdPromoFund
  const daolockParams = config.BscdDaoLock
  const timerParams = config.BscdPresaleTimer
  const presaleParams = config.BscdPresale

  const bscdToken = await BscdToken.deployed()
  const bscdTeamLock = await BscdTeamLock.deployed()
  const bscdStakingFund = await BscdStakingFund.deployed()
  const bscdStaking = await BscdStaking.deployed()
  const bscdPromoFund = await BscdPromoFund.deployed()
  const bscdDaoLock = await BscdDaoLock.deployed()
  const bscdCertifiedPresaleTimer = await BscdCertifiedPresaleTimer.deployed()
  const bscdCertifiedPresale = await BscdCertifiedPresale.deployed()

  await Promise.all([
    bscdToken.initialize(
      tokenParams.name,
      tokenParams.symbol,
      tokenParams.decimals,
      owner,
      tokenParams.taxBP,
      tokenParams.daoTaxBP,
      bscdDaoLock.address,
      bscdStaking.address,
      bscdCertifiedPresale.address
    ),
    bscdTeamLock.initialize(
      teamlockParams.releaseInterval,
      teamlockParams.releaseBP,
      teamlockParams.addresses,
      teamlockParams.basisPoints,
      bscdToken.address
    ),
    bscdStakingFund.initialize(
      stakingFundParams.authorizor,
      stakingFundParams.releaser,
      bscdToken.address
    ),
    bscdStaking.initialize(
      stakingParams.stakingTaxBP,
      stakingParams.unstakingTaxBP,
      stakingParams.registrationFeeWithReferrer,
      stakingParams.registrationFeeWithoutReferrer,
      owner,
      bscdToken.address
    ),
    bscdPromoFund.initialize(
      promoParams.authorizor,
      promoParams.releaser,
      bscdToken.address
    ),
    bscdDaoLock.initialize(
      daolockParams.releaseInterval,
      daolockParams.releaseBP,
      owner,
      bscdToken.address
    ),
    bscdCertifiedPresaleTimer.initialize(
      timerParams.startTime,
      timerParams.baseTimer,
      timerParams.deltaTimer,
      owner
    )
  ])
  console.log('bscdToken initialized');
  console.log('bscdTeamLock initialized');
  console.log('bscdStakingFund initialized');
  console.log('bscdStaking initialized');
  console.log('bscdPromoFund initialized');
  console.log('bscdDaoLock initialized');
  console.log('bscdCertifiedPresaleTimer initialized');
  await bscdToken.addMinter(bscdCertifiedPresale.address)
  console.log('bscdToken minter added');
  await bscdCertifiedPresale.initialize(
    presaleParams.maxBuyPerAddressBase,
    presaleParams.maxBuyPerAddressBP,
    presaleParams.maxBuyWithoutWhitelisting,
    presaleParams.redeemBP,
    presaleParams.redeemInterval,
    presaleParams.referralBP,
    presaleParams.startingPrice,
    presaleParams.multiplierPrice,
    owner,
    bscdCertifiedPresaleTimer.address,
    bscdToken.address
  )
  console.log('bscd presale contract initialized');
  await Promise.all([
    bscdCertifiedPresale.setEtherPools(
      [
        bscdPromoFund.address,
        bscdTeamLock.address
      ],
      [
        presaleParams.etherPools.promoFund,
        presaleParams.etherPools.teamFund
      ]
    ),
    bscdCertifiedPresale.setTokenPools(
      [
        bscdPromoFund.address,
        bscdStakingFund.address,
        bscdTeamLock.address,
        bscdDaoLock.address
      ],
      [
        presaleParams.tokenPools.promoFund,
        presaleParams.tokenPools.stakingFund,
        presaleParams.tokenPools.teamFund,
        presaleParams.tokenPools.daoFund
      ]
    )
  ])
  console.log('bscd presale ether pool configured');
  console.log('bscd presale token pool configured');
}

module.exports = function (deployer, networkName, accounts) {
  deployer.then(async () => {
    await initialize(accounts, networkName)
  })
}
