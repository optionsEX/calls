/*global contract, it*/
const protocol = require('Embark/contracts/Protocol');
const ERC20 = require('Embark/contracts/ERC20');
const USDMock = require('Embark/contracts/USDMock');
const moment = require('moment');
const { toEth, createERC20Instance, fromWei, getBalance, increaseTime } = require('../utils/testUtils');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
let expiration = moment().add(3, 'weeks');
const strike = toEth('300');
const call = 0, put = 1;
const strike100 = '100000000000000000000';
const discount95 = '950000000000000000';
const noDiscount = '1000000000000000000';
const SECONDS_IN_DAY = 86400;
const SECONDS_IN_YEAR = SECONDS_IN_DAY * 365.25;
const getDiffSeconds = (now, future) => (future.unix() - now.unix());

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
    "TokenMock": {},
    "Protocol": {
      "args": [
        "$TokenMock",
        "$USDMock"
      ]
    }
  }
}, (_err, web3_accounts) => {
  accounts = web3_accounts;
});


contract("Protocol", function() {
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

    it('writer closes not transfered balance on option token', async () => {
      const closed = await protocol.methods.close(optionToken._address, toEth('1')).send({from: accounts[0]})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })

    it('writer redeems and receives monies owed from exercises', async () => {
      const balanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(fromWei(balanceUSD), 0);
      const now = moment();
      const future = moment(now).add(13, 'M');
      const time = getDiffSeconds(now, future);
      await increaseTime(Number(time));
      const redeem = await protocol.methods.redeem(optionToken._address).send({from: accounts[0]});
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(fromWei(newBalanceUSD), 300);
    })

  })
})
