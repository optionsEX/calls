/*global contract, it*/
const protocol = require('Embark/contracts/DSFProtocol');
const ERC20 = require('Embark/contracts/ERC20');
const USDMock = require('Embark/contracts/USDMock');
const moment = require('moment');
const { toEth, createERC20Instance, fromWei, getBalance } = require('../utils/testUtils');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
let expiration = moment().add(3, 'weeks');
const strike = toEth('300');
const call = 0, put = 1;
const strike100 = '100000000000000000000';
const discount95 = '950000000000000000';
const noDiscount = '1000000000000000000';


let accounts;

config({
  deployment: {
    // The order here corresponds to the order of `web3.eth.getAccounts`, so the first one is the `defaultAccount`
    accounts: [
      {
        mnemonic: "foster gesture flock merge beach plate dish view friend leave drink valley shield list enemy",
        balance: "5 ether",
        numAddresses: "10"
      }
    ]
  },
  contracts: {
    "USDMock": {},
    "DSFTokenMock": {},
    "DSFProtocol": {
      "args": [
        "$DSFTokenMock",
        "$USDMock"
      ]
    }
  }
}, (_err, web3_accounts) => {
  accounts = web3_accounts;
});


contract("DSFProtocol", function() {
  describe("option token", async() => {
    let optionToken

    it('creates an option token series', async () => {
      const issue = await protocol.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, expiration.unix(), call, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      optionToken = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens option token position with ETH', async () => {
      const opened = await protocol.methods.open(optionToken._address, toEth('2')).send({from: accounts[0], value: toEth('2')})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, toEth('2'))
    })

    it('writer transfers part of balance to new account', async () => {
      await optionToken.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
      const balance = await optionToken.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('new account exercises option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const series = await protocol.methods.seriesInfo(optionToken._address).call();
      const { expiration, strike } = series;
      const balance = await optionToken.methods.balanceOf(accounts[1]).call();
      const ethBalance = await getBalance(accounts[1]);
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await USDMock.methods.approve(protocol._address, toEth(exerciseAmount.toString())).send({from: accounts[1]});
      await protocol.methods.exercise(optionToken._address, toEth('1')).send({from: accounts[1]});
      const newBalance = await optionToken.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceEth = await getBalance(accounts[1]);
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceUSD), 700, "USD balance incorrectly updated");
      assert.strictEqual(Math.trunc(fromWei(newBalanceEth)) - Math.trunc(fromWei(ethBalance)), 1);
    })

    it('writer closes option token', async () => {
      const closed = await protocol.methods.close(optionToken._address, toEth('1')).send({from: accounts[0]})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })
  })

  describe("auction pricing", async () => {

    it('calculates put option price at t=0', async () => {
      const elapsed = 0
      const price = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, noDiscount).call()
      assert.strictEqual(price, '0')
      const dPrice = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, discount95).call()
      assert.strictEqual(dPrice, '0')
    })

    it('calculates put option price at t=6h', async () => {
      const elapsed = 6 * 3600

      const price = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, noDiscount).call()
      assert.strictEqual(price, '50000000000000000000')
      const dPrice = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, discount95).call()
      assert.strictEqual(dPrice, '52631578947368421052')
    })

    it('calculates put option price at t=12h', async () => {
      const elapsed = 12 * 3600

      const price = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, noDiscount).call()
      assert.strictEqual(price, '100000000000000000000')
      const dPrice = await protocol.methods.putAuctionUSDPrice(strike100, elapsed, discount95).call()
      assert.strictEqual(dPrice, '100000000000000000000')
    })

  })
})
