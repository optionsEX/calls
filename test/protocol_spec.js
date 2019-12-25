/*global contract, it*/
const protocol = require('Embark/contracts/DSFProtocol');
const moment = require('moment')
const { toEth } = require('../utils/testUtils')

let expiration = moment().add(3, 'weeks')
const strike = toEth('300')
const call = 0, put = 1

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

    it('creates an option token', async () => {
      const issue = await protocol.methods.issue('JUL 4 300-CALL', '7/4 300-C', expiration.unix(), call, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      optionToken = OptionTokenCreated.returnValues.token
    })
  })
})
