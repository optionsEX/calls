/*global contract, it*/
const BlackScholes = require('Embark/contracts/BlackScholes');
const ERC20 = require('Embark/contracts/ERC20');
const moment = require('moment');
const bs = require('black-scholes');
const { toEth, createERC20Instance } = require('../utils/testUtils')

const SECONDS_IN_DAY = 86400;
const SECONDS_IN_YEAR = SECONDS_IN_DAY * 365.25;

const genOptionTime = (now, future) => (future.unix() - now.unix()) / SECONDS_IN_YEAR
const compareBS = (local, remote) => {
  const lSanitized = Math.trunc(local * 100);
  const rSanitized = Number(remote);
  return lSanitized - rSanitized;
}

let expiration = moment().add(3, 'weeks')
const strike = toEth('300')
const call = 0, put = 1
const strike100 = '100000000000000000000'
const discount95 = '950000000000000000'
const noDiscount = '1000000000000000000'


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
    "BlackScholes": {}
  }
}, (_err, web3_accounts) => {
  accounts = web3_accounts;
});


contract("BlackScholes", function() {
  describe("Pricing options", async() => {

    it('correctly prices in the money call with one year time', async () => {
      const strike = toEth('250');
      const price = toEth('300');
      const now = moment();
      const oneYear = moment(now).add(12, 'M');
      const diff = oneYear.from(now)
      const time = genOptionTime(now, oneYear);
      const vol = 15;
      const rfr = 3;
      const localBS = bs.blackScholes(300, 250, time, .15, .03, "call");
      const contractBS = await BlackScholes.methods.retBlackScholesCalc(price, strike, oneYear.unix(), vol, rfr, call).call();
      assert.strictEqual(compareBS(localBS, contractBS), 0, "difference more than one cent")
    })
  })
})
