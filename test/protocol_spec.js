/*global contract, it*/
const protocol = require('Embark/contracts/DSFProtocol');
const ERC20 = require('Embark/contracts/ERC20')
const moment = require('moment')
const { toEth, createERC20Instance } = require('../utils/testUtils')

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

    it('creates an option token series', async () => {
      const issue = await protocol.methods.issue('JUL 4 300-CALL', '7/4 300-C', expiration.unix(), call, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      optionToken = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens option token position', async () => {
      const opened = await protocol.methods.open(optionToken._address, toEth('1')).send({from: accounts[0], value: toEth('1')})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('closes option token', async () => {
      const closed = await protocol.methods.close(optionToken._address, toEth('1')).send({from: accounts[0]})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })
  })
})
