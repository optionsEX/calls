/*global contract, it*/
const protocol = require('Embark/contracts/Protocol');
const ERC20 = require('Embark/contracts/ERC20');
const USDMock = require('Embark/contracts/USDMock');
const NewToken = require('Embark/contracts/NewToken');
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
    "NewToken": {
       instanceOf: "USDMock",
    },
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
    let currentTime;
    let optionToken;
    let erc20CallOption;
    let erc20CallExpiration;
    let putOption;
    let putOptionExpiration;

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

    it('receiver attempts to close and transaction should revert', async () => {
      let closed;
      try {
        closed = await protocol.methods.close(optionToken._address, toEth('1')).send({from: accounts[1]})
      } catch(e) {
        const reverted = e.message.includes('revert Caller did not write sufficient amount');
        assert.strictEqual(reverted, true);
      }
      const balance = await optionToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(balance, toEth('1'));
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
      currentTime = future;
      const redeem = await protocol.methods.redeem(optionToken._address).send({from: accounts[0]});
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(fromWei(newBalanceUSD), 300);
    })

    it('creates an ERC20 call option token series', async () => {
      const now = moment();
      const future = moment(now).add(14, 'M');
      erc20CallExpiration = future;
      await NewToken.methods.mint(accounts[0], toEth('1000')).send({from: accounts[0]});
      const issue = await protocol.methods.issue(NewToken._address, USDMock._address, future.unix(), call, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      erc20CallOption = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens an ERC20 call option', async () => {
      await NewToken.methods.approve(protocol._address, toEth(toEth('2'))).send({from: accounts[0]});
      const issue = await protocol.methods.open(erc20CallOption._address, toEth('2')).send({from: accounts[0]})
      const balance = await erc20CallOption.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'));
    })

    it('writer transfers part of erc20 call balance to new account', async () => {
      await erc20CallOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
      const balance = await erc20CallOption.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('new account exercises erc20 call option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const usdBalance = await USDMock.methods.balanceOf(accounts[1]).call();
      const oldBalanceToken = await NewToken.methods.balanceOf(accounts[1]).call();
      const series = await protocol.methods.seriesInfo(erc20CallOption._address).call();
      const { expiration, strike } = series;
      const balance = await erc20CallOption.methods.balanceOf(accounts[1]).call();
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await USDMock.methods.approve(protocol._address, toEth(exerciseAmount.toString())).send({from: accounts[1]});
      await protocol.methods.exercise(erc20CallOption._address, toEth('1')).send({from: accounts[1]});
      const newBalance = await erc20CallOption.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceToken = await NewToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual((fromWei(usdBalance) - Number(exerciseAmount)), fromWei(newBalanceUSD), "Strike asset balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceToken), 1, "New Balance of underlying incorrectly updated");
    })

    it('writer closes not transfered balance on ERC20 call option', async () => {
      const closed = await protocol.methods.close(erc20CallOption._address, toEth('1')).send({from: accounts[0]})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })

    it('writer redeems and receives monies owed from ERC20 call exercises', async () => {
      const balanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(fromWei(balanceUSD), 300);
      const future = moment(erc20CallExpiration).add(1, 'M');
      const time = getDiffSeconds(moment(), future);
      await increaseTime(Number(time));
      currentTime = future;
      const redeem = await protocol.methods.redeem(erc20CallOption._address).send({from: accounts[0]});
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      const { underlyingAmount, strikeAmount } = redeem.events.SeriesRedeemed.returnValues;
      assert.strictEqual(underlyingAmount, '0');
      assert.strictEqual(fromWei(strikeAmount), 300);
      assert.strictEqual(fromWei(newBalanceUSD), 600);
    })

    it('creates a put option token series', async () => {
      let expiration = currentTime.add(24, 'M');
      putOptionExpiration = expiration;
      const issue = await protocol.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, expiration.unix(), put, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      putOption = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens put option token position with ETH', async () => {
      const balanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      // amount is amount X strike;
      const amount = 2 * 300;
      await USDMock.methods.approve(protocol._address, toEth(amount)).send({from: accounts[0]});
      const opened = await protocol.methods.open(putOption._address, toEth('2')).send({from: accounts[0]})
      const balance = await putOption.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'))
    })

    it('writer transfers part of put balance to new account', async () => {
      await putOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
      const balance = await putOption.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('new account exercises put option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const originalBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const series = await protocol.methods.seriesInfo(putOption._address).call();
      const { expiration, strike } = series;
      const balance = await putOption.methods.balanceOf(accounts[1]).call();
      const ethBalance = await getBalance(accounts[1]);
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await protocol.methods.exercise(putOption._address, balance).send({from: accounts[1], value: toEth('1')});
      const newBalance = await putOption.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceEth = await getBalance(accounts[1]);
      const expectedUSDBalance = fromWei(originalBalanceUSD) + exerciseAmount
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceUSD), expectedUSDBalance, "USD balance incorrectly updated");
      assert.strictEqual(Math.trunc(fromWei(ethBalance) - Math.trunc(fromWei(newBalanceEth))), 1);
    })

  })
})
