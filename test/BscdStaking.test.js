const { accounts, contract } = require("@openzeppelin/test-environment")
const { expectRevert, time, BN, ether } = require("@openzeppelin/test-helpers")
const {expect} = require("chai")
const config = require("../config")

const BscdToken = contract.fromArtifact("BscdToken")
const BscdStakingV2 = contract.fromArtifact("BscdStaking")
const BscdCertifiedPresale = contract.fromArtifact("BscdCertifiedPresale")
const BscdDaoFund = contract.fromArtifact("BscdDaoLock")

SECONDS_PER_DAY = 86400

const owner = accounts[0]
const stakers = [accounts[1],accounts[2],accounts[3],accounts[4]]
const nonstaker = accounts[5]
const distributionAccount = accounts[6]

describe("BscdToken", function() {
  before(async function() {
    const tokenParams = config.BscdToken
    const stakingParams = config.BscdStaking

    this.bscdToken = await BscdToken.new()
    this.bscdStakingV2 = await BscdStakingV2.new()
    this.bscdCertifiedPresale = await BscdCertifiedPresale.new()
    this.bscdDaoFund = await BscdDaoFund.new()

    await this.bscdToken.initialize(
      tokenParams.name,
      tokenParams.symbol,
      tokenParams.decimals,
      owner,
      tokenParams.taxBP,
      tokenParams.daoTaxBP,
      this.bscdDaoFund.address,
      this.bscdStakingV2.address,
      this.bscdCertifiedPresale.address
    )
    await this.bscdStakingV2.initialize(
      stakingParams.stakingTaxBP,
      stakingParams.unstakingTaxBP,
      stakingParams.registrationFeeWithReferrer,
      stakingParams.registrationFeeWithoutReferrer,
      owner,
      this.bscdToken.address
    )
    await this.bscdStakingV2.v2Initialize(
      this.bscdToken.address,
      { from: owner }
    )


    await Promise.all([
      await this.bscdToken.mint(stakers[0],ether('100000'),{from: owner}),
      await this.bscdToken.mint(stakers[1],ether('100000'),{from: owner}),
      await this.bscdToken.mint(stakers[2],ether('100000'),{from: owner}),
      await this.bscdToken.mint(stakers[3],ether('100000'),{from: owner}),
      await this.bscdToken.mint(nonstaker,ether('100000'),{from: owner}),
      await this.bscdToken.mint(distributionAccount,ether('130000'),{from: owner}),

    ])

    await this.bscdToken.setIsTransfersActive(true,{from:owner})
    await this.bscdToken.setIsTaxActive(true,{from:owner})

    await time.advanceBlock()
    let latest = await time.latest()

    await this.bscdStakingV2.setStartTime(latest.add(new BN(SECONDS_PER_DAY)),{from:owner})

  })

  describe("State: Staking Inactive", function() {
    describe("#stake", function(){
      it("Should revert", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.stake(ether("1"),{from:staker}),
          "Staking not yet started."
        )
      })
    })
    describe("#unstake", function(){
      it("Should revert", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.unstake(ether("1"),{from:staker}),
          "Staking not yet started."
        )
      })
    })
    describe("#withdraw", function(){
      it("Should revert", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.withdraw(ether("1"),{from:staker}),
          "Staking not yet started."
        )
      })
    })
    describe("#reinvest", function(){
      it("Should revert", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.reinvest(ether("1"),{from:staker}),
          "Staking not yet started."
        )
      })
    })
  })
  describe("State: Staking Active", function() {
    before(async function() {
      await time.advanceBlock()
      let latest = await time.latest()
      await time.increase(SECONDS_PER_DAY*30)
    })

    describe("#registerAndStake", function(){
      it("Should revert if less than registrationfee", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.registerAndStake(ether("1").sub(new BN(1)),{from:staker}),
          "Must send at least enough LID to pay registration fee."
        )
        await expectRevert(
          this.bscdStakingV2.registerAndStake(0,{from:staker}),
          "Must send at least enough LID to pay registration fee."
        )
        await expectRevert(
          this.bscdStakingV2.registerAndStake(new BN(1),{from:staker}),
          "Must send at least enough LID to pay registration fee."
        )
      })
      it("Should increase totalStakers by 1", async function() {
        const staker = stakers[0]
        const initialTotalStakers = await this.bscdStakingV2.totalStakers()
        await this.bscdStakingV2.registerAndStake(ether("500"),{from:staker})
        const finalTotalStakers = await this.bscdStakingV2.totalStakers()
        expect(finalTotalStakers.toString())
          .to.equal(initialTotalStakers.add(new BN(1)).toString())
      })
    })

    describe("#stake", function(){
      it("Should revert if staking more tokens than held", async function() {
        const staker = stakers[0]
        const balance = await this.bscdToken.balanceOf(staker)
        expect(balance.toString()).to.not.equal(new BN(0),{from:staker})
        await expectRevert(
          this.bscdStakingV2.stake(balance.add(new BN(1)),{from:staker}),
          "Cannot stake more LID than you hold unstaked."
        )
        await expectRevert(
          this.bscdStakingV2.stake(balance.add(ether("10000000000000")),{from:staker}),
          "Cannot stake more LID than you hold unstaked."
        )
      })
      it("Should decrease stakers balance by value", async function() {
        const staker = stakers[0]
        const value = ether("21000")
        const initialStakersTokens = await this.bscdToken.balanceOf(staker)
        await this.bscdStakingV2.stake(value,{from:staker})
        const finalStakersTokens = await this.bscdToken.balanceOf(staker)
        expect(finalStakersTokens.toString())
          .to.equal(initialStakersTokens.sub(value).toString())
      })
      it("Should not change totalStakers", async function() {
        const staker = stakers[0]
        const initialTotalStakers = await this.bscdStakingV2.totalStakers()
        await this.bscdStakingV2.stake(ether("20000"),{from:staker})
        const finalTotalStakers = await this.bscdStakingV2.totalStakers()
        expect(finalTotalStakers.toString())
          .to.equal(initialTotalStakers.toString())
      })
      it("Should increase totalStaked by value", async function() {
        const staker = stakers[0]
        const value = ether("21000")
        const initialTotalStaked = await this.bscdStakingV2.totalStaked()
        await this.bscdStakingV2.stake(value,{from:staker})
        const finalTotalStaked = await this.bscdStakingV2.totalStaked()
        expect(finalTotalStaked.toString())
          .to.equal(initialTotalStaked.add(value).toString())
      })
      it("Should increase sender's staked amount by value", async function() {
        const staker = stakers[0]
        const value = ether("21000")
        const initialStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        await this.bscdStakingV2.stake(value,{from:staker})
        const finalStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        expect(finalStakerBalance.toString())
          .to.equal(initialStakerBalance.add(value).toString())
      })
    })

    describe("#unstake", function(){
      it("Should revert if less than 1 token", async function() {
        const staker = stakers[0]
        await expectRevert(
          this.bscdStakingV2.unstake(ether("1").sub(new BN(1)),{from:staker}),
          "Must unstake at least one LID."
        )
        await expectRevert(
          this.bscdStakingV2.unstake(0,{from:staker}),
          "Must unstake at least one LID."
        )
        await expectRevert(
          this.bscdStakingV2.unstake(new BN(1),{from:staker}),
          "Must unstake at least one LID."
        )
      })
      it("Should revert if unstaking more tokens than staked", async function() {
        const staker = stakers[0]
        const balance = await this.bscdStakingV2.stakeValue(staker)
        expect(balance.toString()).to.not.equal(new BN(0),{from:staker})
        await expectRevert(
          this.bscdStakingV2.unstake(balance.add(new BN(1)),{from:staker}),
          "Cannot unstake more LID than you have staked."
        )
        await expectRevert(
          this.bscdStakingV2.unstake(balance.add(ether("10000000000000")),{from:staker}),
          "Cannot unstake more LID than you have staked."
        )
      })
      it("Should decrease totalStaked balance by value", async function() {
        const staker = stakers[0]
        const value = ether("10000")
        const initialTotalStaked = await this.bscdStakingV2.totalStaked()
        await this.bscdStakingV2.unstake(value,{from:staker})
        const finalTotalStaked = await this.bscdStakingV2.totalStaked()
        expect(finalTotalStaked.toString())
          .to.equal(initialTotalStaked.sub(value).toString())
      })
      it("Should increase totalStaked by value", async function() {
        const staker = stakers[0]
        const value = ether("10000")
        const initialTotalStaked = await this.bscdStakingV2.totalStaked()
        await this.bscdStakingV2.stake(value,{from:staker})
        const finalTotalStaked = await this.bscdStakingV2.totalStaked()
        expect(finalTotalStaked.toString())
          .to.equal(initialTotalStaked.add(value).toString())
      })
      it("Should decrease sender's staked amount by value", async function() {
        const staker = stakers[0]
        const value = ether("10000")
        const initialStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        await this.bscdStakingV2.unstake(value,{from:staker})
        const finalStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        const staker1DivisQ = await this.bscdStakingV2.dividendsOf(stakers[0])
        expect(finalStakerBalance.toString())
          .to.equal(initialStakerBalance.sub(value).toString())
      })
      describe("Unstake All", function() {
        it("Should decrease totalStakers by 1 & Should keep stakers dividends the same",async function() {
          const staker = stakers[0]
          const totalStaked = await this.bscdStakingV2.totalStaked()
          const initialStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
          const stakerValue = await this.bscdStakingV2.stakeValue(staker)
          const initialTotalStakers = await this.bscdStakingV2.totalStakers()
          const tax = await this.bscdStakingV2.findTaxAmount(stakerValue,new BN(config.BscdStaking.unstakingTaxBP))
          await this.bscdStakingV2.unstake(stakerValue,{from:staker})
          const finalTotalStakers = await this.bscdStakingV2.totalStakers()
          const finalStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
          expect(finalTotalStakers.toString())
            .to.equal(initialTotalStakers.sub(new BN(1)).toString())
          expect(finalStakerDivis.sub(initialStakerDivis).toString())
            .to.equal("0")
        })
      })
    })

    describe("#distribution", function(){
      before(async function() {
        await this.bscdStakingV2.stake(ether("10000"),{from:stakers[0]})
        await this.bscdStakingV2.registerAndStake(ether("15000"),{from:stakers[1]})
        await this.bscdStakingV2.registerAndStake(ether("12000"),{from:stakers[2]})
        await this.bscdStakingV2.registerAndStake(ether("91000"),{from:stakers[3]})
      })
      it("Should revert if distributing more than sender's balance", async function() {
        const balance = await this.bscdToken.balanceOf(distributionAccount)
        await expectRevert(
          this.bscdStakingV2.distribute(balance.add(new BN(1)),{from: distributionAccount}),
          "Cannot distribute more LID than you hold unstaked."
        )
      })
      it("Should increase totalDistributions by value", async function(){
        const value = ether("10000")
        const totalDistributionsInitial = await this.bscdStakingV2.totalDistributions()
        await this.bscdStakingV2.distribute(value,{from: distributionAccount})
        const totalDistributionsFinal = await this.bscdStakingV2.totalDistributions()
        expect(totalDistributionsFinal.toString())
          .to.equal(totalDistributionsInitial.add(value).toString())
      })
      it("Should increase other stakers dividends by distribution/totalStaked * stakeValue", async function() {
        const staker = stakers[1]
        const value = ether("10000")
        const stakerShares = await this.bscdStakingV2.stakeValue(staker)
        const initialStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        await this.bscdStakingV2.distribute(value,{from:distributionAccount})
        const finalStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        const totalStaked = await this.bscdStakingV2.totalStaked()
        expect(value.mul(stakerShares).div(totalStaked).div(new BN("10000")).toString())
          .to.equal(finalStakerDivis.sub(initialStakerDivis).div(new BN("10000")).toString())
      })
    })
    describe("#withdraw", function(){
      it("Should revert if withdrawing more than sender's dividends", async function() {
        const staker = stakers[0]
        const balance = await this.bscdStakingV2.dividendsOf(staker)
        await expectRevert(
          this.bscdStakingV2.withdraw(balance.add(new BN(1)),{from: staker}),
          "Cannot withdraw more dividends than you have earned."
        )
      })
      it("Should increase senders balance by value.", async function() {
        const value = ether("1000")
        const staker = stakers[0]
        const balanceInitial = await this.bscdToken.balanceOf(staker)
        this.bscdStakingV2.withdraw(value,{from: staker})
        const balanceFinal = await this.bscdToken.balanceOf(staker)
        expect(balanceFinal.sub(balanceInitial).toString())
          .to.equal(value.toString())
      })
      it("Should decrease senders dividends by value.", async function() {
        const value = ether("1000")
        const staker = stakers[3]
        const divisInitial = await this.bscdStakingV2.dividendsOf(staker)
        this.bscdStakingV2.withdraw(value,{from: staker})
        const divisFinal = await this.bscdStakingV2.dividendsOf(staker)
        expect(divisInitial.sub(divisFinal).toString())
          .to.equal(value.toString())
      })
    })

    describe("#reinvest", function(){
      it("Should revert if staking more tokens than in dividends", async function() {
        const staker = stakers[1]
        const divis = await this.bscdStakingV2.dividendsOf(staker)
        expect(divis.toString()).to.not.equal(new BN(0),{from:staker})
        await expectRevert(
          this.bscdStakingV2.reinvest(divis.add(new BN(1)),{from:staker}),
          "Cannot reinvest more dividends than you have earned."
        )
        await expectRevert(
          this.bscdStakingV2.reinvest(divis.add(ether("1000000000")),{from:staker}),
          "Cannot reinvest more dividends than you have earned."
        )
      })
      it("Should decrease stakers dividends by value and add stakeValue.", async function() {
        const staker = stakers[1]
        const value = ether("1000")
        const initialStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        await this.bscdStakingV2.reinvest(value,{from:staker})
        const finalStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        const totalStaked = await this.bscdStakingV2.totalStaked()
        const stakerShares = await this.bscdStakingV2.stakeValue(staker)
        expect(initialStakerDivis.sub(finalStakerDivis).toString())
          .to.equal(value.sub(stakerShares.div(totalStaked)).toString())
      })
      it("Should increase totalStaked by value", async function() {
        const staker = stakers[1]
        const value = ether("1000")
        const initialTotalStaked = await this.bscdStakingV2.totalStaked()
        await this.bscdStakingV2.reinvest(value,{from:staker})
        const finalTotalStaked = await this.bscdStakingV2.totalStaked()
        expect(finalTotalStaked.toString())
          .to.equal(initialTotalStaked.add(value).toString())
      })
      it("Should increase sender's staked amount by value minus tax", async function() {
        const staker = stakers[1]
        const value = ether("100")
        const initialStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        await this.bscdStakingV2.reinvest(value,{from:staker})
        const finalStakerBalance = await this.bscdStakingV2.stakeValue(staker)
        expect(finalStakerBalance.toString())
          .to.equal(initialStakerBalance.add(value).toString())
      })
      it("Should not change other stakers dividends", async function() {
        const reinvester = stakers[1]
        const staker = stakers[2]
        const value = ether("50")
        const stakerShares = await this.bscdStakingV2.stakeValue(staker)
        const initialStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        await this.bscdStakingV2.reinvest(value,{from:reinvester})
        const finalStakerDivis = await this.bscdStakingV2.dividendsOf(staker)
        const totalStaked = await this.bscdStakingV2.totalStaked()
        expect(stakerShares.div(totalStaked).toString())
          .to.equal(finalStakerDivis.sub(initialStakerDivis).toString())
      })
    })

    describe("#checkpoint", function(){
      it("#stakeValueAt", async function() {
        // stakers[0]
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 26)).toString(), 0)
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 27)).toString(), ether("300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 30)).toString(), ether("21300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 31)).toString(), ether("41300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 32)).toString(), ether("62300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 33)).toString(), ether("83300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 39)).toString(), ether("73300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 40)).toString(), ether("83300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 41)).toString(), ether("73300"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 42)).toString(), 0)
        expect((await this.bscdStakingV2.stakeValueAt(stakers[0], 43)).toString(), ether("10000"))

        // stakers[1]
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 43)).toString(), 0)
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 44)).toString(), ether("14800"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 55)).toString(), ether("15800"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 56)).toString(), ether("16800"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 57)).toString(), ether("16900"))
        expect((await this.bscdStakingV2.stakeValueAt(stakers[1], 58)).toString(), ether("16950"))

        // stakers[2]
        expect((await this.bscdStakingV2.stakeValueAt(stakers[2], 44)).toString(), 0)
        expect((await this.bscdStakingV2.stakeValueAt(stakers[2], 45)).toString(), ether("11800"))

        // stakers[3]
        expect((await this.bscdStakingV2.stakeValueAt(stakers[3], 45)).toString(), 0)
        expect((await this.bscdStakingV2.stakeValueAt(stakers[3], 46)).toString(), ether("90800"))
      })
      it("#totalStakedAt", async function() {
        expect((await this.bscdStakingV2.totalStakedAt(26)).toString(), 0)
        expect((await this.bscdStakingV2.totalStakedAt(27)).toString(), ether("300"))
        expect((await this.bscdStakingV2.totalStakedAt(30)).toString(), ether("21300"))
        expect((await this.bscdStakingV2.totalStakedAt(31)).toString(), ether("41300"))
        expect((await this.bscdStakingV2.totalStakedAt(32)).toString(), ether("62300"))
        expect((await this.bscdStakingV2.totalStakedAt(33)).toString(), ether("83300"))
        expect((await this.bscdStakingV2.totalStakedAt(39)).toString(), ether("73300"))
        expect((await this.bscdStakingV2.totalStakedAt(40)).toString(), ether("83300"))
        expect((await this.bscdStakingV2.totalStakedAt(41)).toString(), ether("73300"))
        expect((await this.bscdStakingV2.totalStakedAt(42)).toString(), 0)
        expect((await this.bscdStakingV2.totalStakedAt(43)).toString(), ether("10000"))
        expect((await this.bscdStakingV2.totalStakedAt(44)).toString(), ether("24800"))
        expect((await this.bscdStakingV2.totalStakedAt(45)).toString(), ether("36600"))
        expect((await this.bscdStakingV2.totalStakedAt(46)).toString(), ether("127400"))
        expect((await this.bscdStakingV2.totalStakedAt(55)).toString(), ether("128400"))
        expect((await this.bscdStakingV2.totalStakedAt(56)).toString(), ether("129400"))
        expect((await this.bscdStakingV2.totalStakedAt(57)).toString(), ether("129500"))
        expect((await this.bscdStakingV2.totalStakedAt(58)).toString(), ether("129550"))
      })
    })
  })
})
