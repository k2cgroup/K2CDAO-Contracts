const { ether, BN } = require("@openzeppelin/test-helpers")

let config = {}

config.BscdToken = {
  name: "K2C Dao Token",
  symbol: "K2CDAO",
  decimals: 18,
  taxBP: 190,
  daoTaxBP: 10
}

config.BscdStaking = {
  stakingTaxBP: 0,
  unstakingTaxBP: 200,
  startTime: 1616457600,
  // startTime: 1596322800, // 10 days later from presale
  registrationFeeWithReferrer: ether("400"),
  registrationFeeWithoutReferrer: ether("200")
}

config.BscdPresale = {
  maxBuyPerAddressBase: ether("10"), // total presale amount
  maxBuyPerAddressBP: 200,
  maxBuyWithoutWhitelisting: ether("1"), // limit every account
  redeemBP: 200,
  redeemInterval: 3600,
  referralBP: 250,
  startingPrice: ether("0.01096852"), // 1bscd = 0.00002 bnb
  multiplierPrice: new BN("600000"),
  etherPools: {
    promoFund: 500,
    teamFund: 2000
  },
  tokenPools: {
    promoFund: 500,
    stakingFund: 900,
    teamFund: 1000,
    daoFund: 2000
  }
}

config.BscdPresaleTimer = {
  startTime: 1616112000,
  // startTime: 1595383200, // presale start time
  baseTimer: 48 * 3600, //48 hours
  deltaTimer: 8 * 3600, //8 hours
}

config.BscdTeamLock = {
  releaseInterval: 24 * 3600,
  releaseBP: 33,
  addresses: [
    "0x9ee1B8Fd52321De805772EFea2F6AeFeEeDc735d",
    "0xc5A691eF46624E507d1bF44D48017f5CDe901FcE",
    "0x94b610b0B9F7471f817aC7c280a81Beef521DF36",
    "0xE8d2eFa12a9bECe874a3376d98eB789F70ffdae0",
    "0xf43BF0169C089dd023A197C65A456e3B374a7bF3",
    "0xa4Da0fbE30d3254C6520A93F1F2FfeFBE6b8e1d4",
  ],
  basisPoints: [
    3500,
    2500,
    1500,
    1500,
    500,
    500
  ]
}

config.BscdDaoLock = {
  releaseInterval: 24 * 3600,
  releaseBP: 16
}

config.BscdPromoFund = {
  authorizor: "0x9ee1B8Fd52321De805772EFea2F6AeFeEeDc735d",
  releaser: "0xc5A691eF46624E507d1bF44D48017f5CDe901FcE"
}

config.BscdStakingFund = {
  authorizor: "0x9ee1B8Fd52321De805772EFea2F6AeFeEeDc735d",
  releaser: "0xc5A691eF46624E507d1bF44D48017f5CDe901FcE"
}

module.exports = config
