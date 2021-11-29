const { accounts, contract, web3 } = require("@openzeppelin/test-environment")
const { expectRevert, time, BN, ether, balance } = require("@openzeppelin/test-helpers")
const {expect} = require("chai")
const config = require("../config")

const BscdToken = contract.fromArtifact("BscdToken")
const BscdStaking = contract.fromArtifact("BscdStaking")
const BscdTeamLock = contract.fromArtifact("BscdTeamLock")
const BscdDaoLock = contract.fromArtifact("BscdDaoLock")
const BscdPromoFund = contract.fromArtifact("BscdPromoFund")
const BscdCertifiedPresale = contract.fromArtifact("BscdCertifiedPresale")
const BscdCertifiedPresaleTimer = contract.fromArtifact("BscdCertifiedPresaleTimer")


const owner = accounts[0]
const buyers = [accounts[1],accounts[2],accounts[3],accounts[4]]
const notWhitelisted = accounts[5]

describe("BscdPresale", function() {
  before(async function() {
    const tokenParams = config.BscdToken
    const stakingParams = config.BscdStaking
    const presaleParams = config.BscdPresale
    const timerParams = config.BscdPresaleTimer

    this.bscdToken = await BscdToken.new()
    this.bscdStaking = await BscdStaking.new()
    this.bscdTeamFund = await BscdTeamLock.new()
    this.bscdPromoFund = await BscdPromoFund.new()
    this.bscdDaoFund = await BscdPromoFund.new()
    this.bscdPresale = await BscdCertifiedPresale.new()
    this.bscdTimer = await BscdCertifiedPresaleTimer.new()


    await this.bscdToken.initialize(
      tokenParams.name,
      tokenParams.symbol,
      tokenParams.decimals,
      owner,
      tokenParams.taxBP,
      tokenParams.daoTaxBP,
      this.bscdDaoFund.address,
      this.bscdStaking.address,
      this.bscdPresale.address
    )
    await this.bscdToken.addMinter(this.bscdPresale.address,{from:owner})
    await this.bscdStaking.initialize(
      stakingParams.stakingTaxBP,
      stakingParams.unstakingTaxBP,
      stakingParams.registrationFeeWithReferrer,
      stakingParams.registrationFeeWithoutReferrer,
      owner,
      this.bscdToken.address
    )
    await this.bscdTimer.initialize(
      timerParams.startTime,
      timerParams.baseTimer,
      timerParams.deltaTimer,
      owner
    )
    await this.bscdPresale.initialize(
      presaleParams.maxBuyPerAddressBase,
      presaleParams.maxBuyPerAddressBP,
      presaleParams.maxBuyWithoutWhitelisting,
      presaleParams.redeemBP,
      presaleParams.redeemInterval,
      presaleParams.referralBP,
      presaleParams.startingPrice,
      presaleParams.multiplierPrice,
      owner,
      this.bscdTimer.address,
      this.bscdToken.address
    )

    await this.bscdPresale.setEtherPools(
      [
        this.bscdPromoFund.address,
        this.bscdTeamFund.address
      ],
      [
        presaleParams.etherPools.promoFund,
        presaleParams.etherPools.teamFund
      ],
      {from: owner}
    )

    await this.bscdPresale.setTokenPools(
      [
        this.bscdPromoFund.address,
        this.bscdStaking.address,
        this.bscdTeamFund.address,
        this.bscdDaoFund.address
      ],
      [
        presaleParams.tokenPools.promoFund,
        presaleParams.tokenPools.stakingFund,
        presaleParams.tokenPools.teamFund,
        presaleParams.tokenPools.daoFund,
      ],
      {from: owner}
    )

    await this.bscdStaking.setStartTime(new BN(1),{from:owner})


  })

  describe("Stateless", function() {
    describe("#setWhitelist", function() {
      it("Should revert from non owner", async function() {
        const buyer = buyers[0]
        await expectRevert(
          this.bscdPresale.setWhitelist(buyer,true,{from:buyer}),
          "Ownable: caller is not the owner"
        )
      })
      it("Should whitelist non whitelisted account", async function() {
        const buyer = buyers[0]
        const initialWhitelist = await this.bscdPresale.whitelist(buyer)
        await this.bscdPresale.setWhitelist(buyer,true,{from:owner})
        const finalWhitelist = await this.bscdPresale.whitelist(buyer)
        expect(initialWhitelist).to.equal(false)
        expect(finalWhitelist).to.equal(true)
      })
      it("Should unwhitelist account", async function() {
        const buyer = buyers[0]
        const initialWhitelist = await this.bscdPresale.whitelist(buyer)
        await this.bscdPresale.setWhitelist(buyer,false,{from:owner})
        const finalWhitelist = await this.bscdPresale.whitelist(buyer)
        expect(initialWhitelist).to.equal(true)
        expect(finalWhitelist).to.equal(false)
      })
    })
    describe("#setWhitelistForAll", function() {
      it("Should whitelist all addresses", async function() {
        await this.bscdPresale.setWhitelistForAll(buyers,true,{from:owner})
        let whitelistVals = await Promise.all(buyers.map((buyer)=>{
          return this.bscdPresale.whitelist(buyer)
        }))
        expect(whitelistVals.reduce((acc,val)=>{
          return acc && val
        })).to.equal(true)
      })
    })
    describe("#getMaxWhitelistedDeposit", function() {
      it("Should be base at deposit 0 eth.", async function() {
        const actualMax = await this.bscdPresale.getMaxWhitelistedDeposit("0")
        const expectMax = config.BscdPresale.maxBuyPerAddressBase
        expect(expectMax.toString()).to.equal(actualMax.toString())
      })
      it("Should be base + bp*val at deposit val eth.", async function() {
        const val = ether("1302.13")
        const actualMax = await this.bscdPresale.getMaxWhitelistedDeposit(val)
        const expectMax = new BN(config.BscdPresale.maxBuyPerAddressBase.toString()).add(
          val.mul(new BN(config.BscdPresale.maxBuyPerAddressBP.toString())).div(new BN("10000"))
        )
        expect(expectMax.toString()).to.equal(actualMax.toString())
      })
    })
  })


  describe("State: Before Presale Start", function() {
    describe("#deposit", function() {
      it("Should revert", async function() {
        const startTime = await this.bscdTimer.startTime()
        const isStarted = await this.bscdTimer.isStarted()
        const buyer = buyers[0]
        await expectRevert(
          this.bscdPresale.deposit({from:buyer}),
          "Presale not yet started."
        )
      })
    })
    describe("#sendToJulswap", function() {
      it("Should revert", async function() {
        const buyer = buyers[0]
        await expectRevert(
          this.bscdPresale.sendToJulswap({from:buyer}),
          "Presale not yet started."
        )
      })
    })
  })



  describe("State: Presale Active", function() {
    before(async function() {
      await this.bscdTimer.setStartTime((Math.floor(Date.now()/1000) - 60).toString(),{from:owner})
    })
    describe("#sendToJulswap", function() {
      it("Should revert", async function() {
        const buyer = buyers[0]
        await expectRevert(
          this.bscdPresale.sendToJulswap({from:buyer}),
          "Presale has not yet ended."
        )
      })
    })
    describe("#deposit", function() {
      it("Should not allow more than nonWhitelisted max buy if not on whitelist.", async function() {
        await expectRevert(
          this.bscdPresale.deposit({from:notWhitelisted,value:config.BscdPresale.maxBuyWithoutWhitelisting.add(new BN(1))}),
          "Deposit exceeds max buy per address for non-whitelisted addresses."
        )
      })
      it("Should revert if buy higher than max", async function() {
        const buyer = buyers[0]
        const totalDeposit = await web3.eth.getBalance(this.bscdPresale.address)
        const max = new BN(await this.bscdPresale.getMaxWhitelistedDeposit(totalDeposit))

        await expectRevert(
          this.bscdPresale.deposit({from:buyer,value:max.add(new BN(1))}),
          "Deposit exceeds max buy per address for whitelisted addresses."
        )
        await expectRevert(
          this.bscdPresale.deposit({from:buyer,value:max.add(ether("10000000000000"))}),
          "Deposit exceeds max buy per address for whitelisted addresses."
        )
      })
    })
    it("Should revert if less than 0.01 ether", async function() {
      const buyer = buyers[0]
      await expectRevert(
        this.bscdPresale.deposit({from:buyer,value:"0"}),
        "Must purchase at least 0.01 ether."
      )
    })
    describe("On buyer1 success", function(){
      before(async function(){
        const buyer = buyers[0]
        this.bscdPresale.deposit({from:buyer,value:config.BscdPresale.maxBuyPerAddress})
      })
    })
    describe("On buyer2 success", function(){
      before(async function(){
        const buyer = buyers[1]
        this.bscdPresale.deposit({from:buyer,value:config.BscdPresale.maxBuyPerAddress})
      })
    })
    describe("On final buyer attempts", function(){
      it("Should revert if greater than max", async function() {
        const buyer = buyers[2]

        const totalDeposit = await web3.eth.getBalance(this.bscdPresale.address)
        const max = new BN(await this.bscdPresale.getMaxWhitelistedDeposit(totalDeposit))

        await expectRevert(
          this.bscdPresale.deposit({from:buyer,value:max.add(new BN(1))}),
          "Deposit exceeds max buy per address for whitelisted addresses."
        )
      })
      it("Should revert if time is after endtime.", async function() {
        await this.bscdTimer.setStartTime("1",{from:owner})
        const buyer = buyers[2]

        const totalDeposit = await web3.eth.getBalance(this.bscdPresale.address)
        const max = new BN(await this.bscdPresale.getMaxWhitelistedDeposit(totalDeposit))
        const endTime = await this.bscdTimer.getEndTime(totalDeposit)

        await expectRevert(
          this.bscdPresale.deposit({from:buyer,value:max}),
          "Presale has ended."
        )
      })
    })
  })



  describe("State: Presale Ended", function() {
    describe("#deposit", function() {
      it("Should revert", async function() {
        const buyer = buyers[0]
        await expectRevert(
          this.bscdPresale.deposit({from:buyer}),
          "Presale has ended."
        )
      })
    })
  })
})
