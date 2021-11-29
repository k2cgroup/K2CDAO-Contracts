const { accounts, contract, web3 } = require("@openzeppelin/test-environment")
const { expectRevert, time, BN, ether, balance } = require("@openzeppelin/test-helpers")
const {expect} = require("chai")
const config = require("../config")

const BscdToken = contract.fromArtifact("BscdToken")
const BscdStaking = contract.fromArtifact("BscdStaking")
const BscdCertifiedPresale = contract.fromArtifact("BscdCertifiedPresale")
const BscdDaoFund = contract.fromArtifact("BscdDaoLock")


const owner = accounts[0]
const transferFromAccounts = [accounts[1],accounts[2],accounts[3],accounts[9]]
const transferToAccounts = [accounts[4],accounts[5],accounts[6],accounts[10]]
const emptyAccount = accounts[7]
const approvedSender = accounts[8]

describe("BscdToken", function() {
  before(async function() {
    const tokenParams = config.BscdToken
    const stakingParams = config.BscdStaking

    this.bscdToken = await BscdToken.new()
    this.bscdStaking = await BscdStaking.new()
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
      this.bscdStaking.address,
      this.bscdCertifiedPresale.address
    )
    await this.bscdStaking.initialize(
      stakingParams.stakingTaxBP,
      stakingParams.unstakingTaxBP,
      stakingParams.registrationFeeWithReferrer,
      stakingParams.registrationFeeWithoutReferrer,
      owner,
      this.bscdToken.address
    )

    await this.bscdStaking.setStartTime(new BN("1"),{from:owner})

    await Promise.all([
      await this.bscdToken.mint(transferFromAccounts[0],ether('10'),{from: owner}),
      await this.bscdToken.mint(transferFromAccounts[1],ether('10'),{from: owner}),
      await this.bscdToken.mint(transferFromAccounts[2],ether('10'),{from: owner})
    ])


  })



  describe("Stateless", function(){
    describe("#taxBP", function(){
      it("Should be taxBP.", async function() {
        let taxBP = await this.bscdToken.taxBP()
        expect(taxBP.toString()).to.equal(config.BscdToken.taxBP.toString())
      })
    })
    describe("#findTaxAmount", function(){
      it("Should return taxBP/10000 of value passed.", async function() {
        let {tax, daoTax} = await this.bscdToken.findTaxAmount(ether("1"))
        let expectedTax = ether("1")
          .mul((new BN(config.BscdToken.taxBP)).add(new BN(config.BscdToken.daoTaxBP)))
          .div(new BN(10000))
        expect((tax.add(daoTax)).toString()).to.equal(expectedTax.toString())
      })
    })
  })

  describe("State: isTransfersActive=false", function (){
    describe("#isTransfersActive", function(){
      it("Should be false.", async function() {
        let isTransfersActive = await this.bscdToken.isTransfersActive()
        expect(isTransfersActive).to.equal(false)
      })
    })
    describe("#transfer", function(){
      it("Should revert.", async function() {
        await expectRevert(
          this.bscdToken.transfer(transferToAccounts[0],ether("10").add(new BN(1)),{from:transferFromAccounts[0]}),
          "Transfers are currently locked."
        )
      })
    })
    describe("#transferFrom", function(){
      it("All transferFrom should revert.", async function() {
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        await expectRevert(
          this.bscdToken.transferFrom(sender,receiver,ether("5").add(new BN(1)),{from:approvedSender}),
          "Transfers are currently locked."
        )
      })
    })
  })

  describe("State: isTaxActive=false, isTransfersActive=true", function(){
    before(async function() {
      await this.bscdToken.setIsTransfersActive(true,{from:owner})
    })
    describe("#isTransfersActive", function(){
      it("Should be true.", async function() {
        let isTransfersActive = await this.bscdToken.isTransfersActive()
        expect(isTransfersActive).to.equal(true)
      })
    })
    describe("#isTaxActive", function(){
      it("Should be false.", async function() {
        let isTaxActive = await this.bscdToken.isTaxActive()
        expect(isTaxActive).to.equal(false)
      })
    })
    describe("#transfer", function(){
      it("Should revert if msg.sender sends more than their balance", async function() {
        await expectRevert(
          this.bscdToken.transfer(transferToAccounts[0],ether("10").add(new BN(1)),{from:transferFromAccounts[0]}),
          "ERC20: transfer amount exceeds balance"
        )
      })
      it("Should increase receiver by value", async function() {
        const receiver = transferToAccounts[0]
        const sender = transferFromAccounts[0]
        const receiverInitialBalance = await this.bscdToken.balanceOf(receiver)
        await this.bscdToken.transfer(receiver,ether("1"),{from:sender})
        const receiverFinalBalance = await this.bscdToken.balanceOf(receiver)
        expect(receiverFinalBalance.toString()).to.equal(receiverInitialBalance.add(ether("1")).toString())
      })
      it("Should decrease sender by value", async function() {
        const receiver = transferToAccounts[0]
        const sender = transferFromAccounts[0]
        const senderInitialBalance = await this.bscdToken.balanceOf(sender)
        await this.bscdToken.transfer(receiver,ether("1"),{from:sender})
        const senderFinalBalance = await this.bscdToken.balanceOf(sender)
        expect(senderFinalBalance.toString()).to.equal(senderInitialBalance.sub(ether("1")).toString())
      })
    })
    describe("#transferFrom", function(){
      before(async function() {
        await this.bscdToken.approve(approvedSender,ether("2"),{from:transferFromAccounts[1]})
      })
      it("Should revert if msg.sender does not have enough approved", async function() {
          const receiver = transferToAccounts[1]
          const sender = transferFromAccounts[1]
        await expectRevert(
          this.bscdToken.transferFrom(sender,receiver,ether("5").add(new BN(1)),{from:approvedSender}),
          "Transfer amount exceeds allowance"
        )
      })
      it("Should increase receiver by value", async function() {
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        const receiverInitialBalance = await this.bscdToken.balanceOf(receiver)
        await this.bscdToken.transferFrom(sender,receiver,ether("1"),{from:approvedSender})
        const receiverFinalBalance = await this.bscdToken.balanceOf(receiver)
        expect(receiverFinalBalance.toString()).to.equal(receiverInitialBalance.add(ether("1")).toString())
      })
      it("Should decrease sender by value", async function() {
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        const senderInitialBalance = await this.bscdToken.balanceOf(sender)
        await this.bscdToken.transferFrom(sender,receiver,ether("1"),{from:approvedSender})
        const senderFinalBalance = await this.bscdToken.balanceOf(sender)
        expect(senderFinalBalance.toString()).to.equal(senderInitialBalance.sub(ether("1")).toString())
      })
    })
  })



  describe("State: isTaxActive=true", function(){
    before(async function() {
      await this.bscdToken.setIsTaxActive(true,{from:owner})
    })
    describe("#isTaxActive", function(){
      it("Should be true.", async function() {
        let isTaxActive = await this.bscdToken.isTaxActive()
        expect(isTaxActive).to.equal(true)
      })
    })
    describe("#transfer", function(){
      it("Should revert if msg.sender sends more than their balance", async function() {
        await expectRevert(
          this.bscdToken.transfer(transferToAccounts[0],ether("10").add(new BN(1)),{from:transferFromAccounts[0]}),
          "ERC20: transfer amount exceeds balance"
        )
      })
      it("Should increase receiver by value minus tax.", async function() {
        const {tax, daoTax} = await this.bscdToken.findTaxAmount(ether("1"))
        const receiver = transferToAccounts[0]
        const sender = transferFromAccounts[0]
        const receiverInitialBalance = await this.bscdToken.balanceOf(receiver)
        await this.bscdToken.transfer(receiver,ether("1"),{from:sender})
        const receiverFinalBalance = await this.bscdToken.balanceOf(receiver)
        expect(receiverFinalBalance.toString()).to.equal(receiverInitialBalance.add(ether("1")).sub(tax).sub(daoTax).toString())
      })
      it("Should decrease sender by value", async function() {
        const receiver = transferToAccounts[0]
        const sender = transferFromAccounts[0]
        const senderInitialBalance = await this.bscdToken.balanceOf(sender)
        await this.bscdToken.transfer(receiver,ether("1"),{from:sender})
        const senderFinalBalance = await this.bscdToken.balanceOf(sender)
        expect(senderFinalBalance.toString()).to.equal(senderInitialBalance.sub(ether("1")).toString())
      })
      it("Should increase staking contract by tax", async function() {
        const receiver = transferToAccounts[0]
        const sender = transferFromAccounts[0]
        const stakingInitialBalance = await this.bscdToken.balanceOf(this.bscdStaking.address);
        await this.bscdToken.transfer(receiver,ether("1"),{from:sender})
        const {tax, daoTax} = await this.bscdToken.findTaxAmount(ether("1"));
        const stakingFinalBalance = await this.bscdToken.balanceOf(this.bscdStaking.address);
        expect(stakingFinalBalance.toString()).to.equal(stakingInitialBalance.add(tax).toString())
      })
    })
    describe("#transferFrom", function(){
      before(async function() {
        await this.bscdToken.approve(approvedSender,ether("3"),{from:transferFromAccounts[1]})
      })
      it("Should revert if msg.sender does not have enough approved", async function() {
          const receiver = transferToAccounts[1]
          const sender = transferFromAccounts[1]
        await expectRevert(
          this.bscdToken.transferFrom(sender,receiver,ether("5").add(new BN(1)),{from:approvedSender}),
          "Transfer amount exceeds allowance"
        )
      })
      it("Should increase receiver by value minus tax", async function() {
        const {tax, daoTax} = await this.bscdToken.findTaxAmount(ether("1"))
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        const receiverInitialBalance = await this.bscdToken.balanceOf(receiver)
        await this.bscdToken.transferFrom(sender,receiver,ether("1"),{from:approvedSender})
        const receiverFinalBalance = await this.bscdToken.balanceOf(receiver)
        expect(receiverFinalBalance.toString()).to.equal(receiverInitialBalance.add(ether("1")).sub(tax).sub(daoTax).toString())
      })
      it("Should decrease sender by value", async function() {
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        const senderInitialBalance = await this.bscdToken.balanceOf(sender)
        await this.bscdToken.transferFrom(sender,receiver,ether("1"),{from:approvedSender})
        const senderFinalBalance = await this.bscdToken.balanceOf(sender)
        expect(senderFinalBalance.toString()).to.equal(senderInitialBalance.sub(ether("1")).toString())
      })
      it("Should increase staking contract by tax", async function() {
        const receiver = transferToAccounts[1]
        const sender = transferFromAccounts[1]
        const stakingInitialBalance = await this.bscdToken.balanceOf(this.bscdStaking.address);
        await this.bscdToken.transferFrom(sender,receiver,ether("1"),{from:approvedSender})
        const {tax, daoTax} = await this.bscdToken.findTaxAmount(ether("1"));
        const stakingFinalBalance = await this.bscdToken.balanceOf(this.bscdStaking.address);
        expect(stakingFinalBalance.toString()).to.equal(stakingInitialBalance.add(tax).toString())
      })
    })
  })
})
