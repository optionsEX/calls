/*global contract, it*/
const protocol = artifacts.require('Protocol');
const optionRegistry = artifacts.require('OptionRegistry');
const exchange = artifacts.require('Exchange');
const liquidityPools = artifacts.require('LiquidityPools');
const uniswapFactory = artifacts.require('uniswap_factory');
const uniswapExchange = artifacts.require('uniswap_exchange');
const uniswapV2Factory = artifacts.require('UniswapV2Factory');
const uniswapV2Router = artifacts.require('UniswapV2Router01');
const priceFeed = artifacts.require('PriceFeed');
const Time = artifacts.require('Time');
const ERC20 = artifacts.require('ERC20');
const USDMock = artifacts.require('USDMock');
const NewToken = artifacts.require('NewToken');
const WETH9 = artifacts.require('WETH9');
const moment = require('moment');
const bs = require('black-scholes');
const bsFormula = require('bs-formula');
const { toEth, createERC20Instance, createLiquidityPoolInstance, createUniswapExchangeInstance, createUniswapPairInstance, fromWei, getBalance, increaseTime, genOptionTimeFromUnix, toWei } = require('../utils/testUtils');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
let expiration = moment().add(3, 'weeks');
const strike = toEth('300');
const call = 0, put = 1;
const strike100 = '100000000000000000000';
const discount95 = '950000000000000000';
const noDiscount = '1000000000000000000';
const SECONDS_IN_DAY = 86400;
const SECONDS_IN_YEAR = SECONDS_IN_DAY * 365.25;
const IMPLIED_VOL = '60';
const getDiffSeconds = (now, future) => (future.unix() - now.unix());
async function generateExpiration(months = 1) {
  const chainTime = await Time.methods.getCurrent().call();
  const expiration = moment(Number(chainTime) * 1000).add(months, 'M');
  return expiration;
}

let accounts;
const gas = 5000000

config({
  blockchain: {
    // The order here corresponds to the order of `web3.eth.getAccounts`, so the first one is the `defaultAccount`
    accounts: [
      {
        mnemonic: "foster gesture flock merge beach plate dish view friend leave drink valley shield list enemy",
        balance: "100 ether",
        numAddresses: "10"
      }
    ]
  },
  contracts: {
    deploy: {
    "Constants": {},
    "Exchange": {},
    "LiquidityPools": {},
    "NormalDist": {},
    "USDMock": {},
    "TokenMock": {},
    "Time": {},
    "OptionRegistry": {
      "args": [
        "$USDMock"
      ]
    },
    "NewToken": {
       instanceOf: "USDMock",
    },
    "Protocol": {
      "args": [
        "$OptionRegistry",
        "$LiquidityPools",
        "$PriceFeed"
      ]
    },
    "PriceFeed": {
      "args": ["$uniswap_factory"]
    },
    "uniswap_exchange": {},
    "uniswap_factory": {},
    "UniswapV2Factory": {
      "args": [ZERO_ADDRESS]
    },
    "UniswapV2Router01": {
      "args": ["$UniswapV2Factory", "$WETH9"]
    },
    "WETH9": {}
    }
  }
}, (_err, web3_accounts) => {
  accounts = web3_accounts;
});


contract("Protocol", function() {
  let currentTime;
  let ethUsdUniswap;
  describe("option token", async() => {
    let optionToken;
    let erc20CallOption;
    let erc20CallExpiration;
    let putOption;
    let putOptionExpiration;
    let erc20PutOption;
    let erc20PutOptionExpiration;

    before(async () => {
      // set protocol in liquidity pools
      await liquidityPools.methods.setup(protocol._address).send({from: accounts[0]});

      const init = await uniswapFactory.methods.initializeFactory(uniswapExchange._address).send({from: accounts[2]});
      const create = await uniswapFactory.methods.createExchange(USDMock._address).send({from: accounts[2]});
      const { events: { NewExchange } } = create;
      //const wethUsdCreate = await uniswapV2Factory.methods.createPair(WETH9._address, USDMock._address).send({from: accounts[0]});
      //const { events: { PairCreated } } = wethUsdCreate
      //console.log({PairCreated});
      const usdUniswapAddress = NewExchange.returnValues.exchange;
      ethUsdUniswap = createUniswapExchangeInstance(usdUniswapAddress);
      const usdAmount = 300 * 10;
      const usdWei = toEth(usdAmount.toString());
      await USDMock.methods.mint(accounts[2], usdWei).send({from: accounts[2]});
      await USDMock.methods.approve(ethUsdUniswap._address, usdWei).send({from: accounts[2]});
      // set initial price ETH/USD @ 300
      const addedLiquidity = await ethUsdUniswap.methods.addLiquidity('0', usdWei, expiration.unix()).send({
        from: accounts[2],
        value: toEth('10'),
        gas: 5000000
      });
      const { events: { AddLiquidity, Transfer } } = addedLiquidity
      assert.strictEqual(AddLiquidity.returnValues.token_amount, usdWei, "supplied token amount does not match expected");
      await USDMock.methods.mint(accounts[2], usdWei).send({from: accounts[2]});
      await USDMock.methods.approve(uniswapV2Router._address, usdWei).send({from: accounts[2]});
      const addLiquidityV2 = await uniswapV2Router.methods.addLiquidityETH(
        USDMock._address,
        usdWei,
        toEth('10'),
        toEth('10'),
        accounts[2],
        expiration.unix()
      ).send({from: accounts[2], value: toEth('10')});
      const lEvents = addLiquidityV2.events
      const wethUsdAddress = await uniswapV2Factory.methods.getPair(WETH9._address, USDMock._address).call();
      const wethUsdPair = createUniswapPairInstance(wethUsdAddress);
      const wethUsdReserves = await wethUsdPair.methods.getReserves().call();
      const quote = await uniswapV2Router.methods.quote(toEth('3'), wethUsdReserves['0'], wethUsdReserves['1']).call();
      assert.strictEqual(fromWei(quote), 0.01);
    });

    it('creates an option token series', async () => {
      const issue = await optionRegistry.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, expiration.unix(), call, strike).send({from: accounts[0], gas})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      optionToken = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens option token with ETH', async () => {
      const opened = await optionRegistry.methods.open(optionToken._address, toEth('2')).send({from: accounts[0], value: toEth('2')})
      const balance = await optionToken.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, toEth('2'))
    })

    it('writer transfers part of balance to new account', async () => {
      await optionToken.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0], gas})
      const balance = await optionToken.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('receiver attempts to close and transaction should revert', async () => {
      let closed;
      try {
        closed = await optionRegistry.methods.close(optionToken._address, toEth('1')).send({from: accounts[1]})
      } catch(e) {
        const reverted = e.message.includes('revert Caller did not write sufficient amount');
        assert.strictEqual(reverted, true);
      }
      const balance = await optionToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(balance, toEth('1'));
    })

    it('new account exercises option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const series = await optionRegistry.methods.seriesInfo(optionToken._address).call();
      const { expiration, strike } = series;
      const balance = await optionToken.methods.balanceOf(accounts[1]).call();
      const ethBalance = await getBalance(accounts[1]);
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await USDMock.methods.approve(optionRegistry._address, toEth(exerciseAmount.toString())).send({from: accounts[1]});
      await optionRegistry.methods.exercise(optionToken._address, toEth('1')).send({from: accounts[1]});
      const newBalance = await optionToken.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceEth = await getBalance(accounts[1]);
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceUSD), 700, "USD balance incorrectly updated");
      assert.strictEqual(Math.trunc(fromWei(newBalanceEth)) - Math.trunc(fromWei(ethBalance)), 1);
    })

    it('writer closes not transfered balance on option token', async () => {
      const closed = await optionRegistry.methods.close(optionToken._address, toEth('1')).send({from: accounts[0]})
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
      const redeem = await optionRegistry.methods.redeem(optionToken._address).send({from: accounts[0]});
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(fromWei(newBalanceUSD), 300);
    })

    it('creates an ERC20 call option token series', async () => {
      const now = moment();
      const future = moment(now).add(14, 'M');
      erc20CallExpiration = future;
      await NewToken.methods.mint(accounts[0], toEth('1000')).send({from: accounts[0]});
      const issue = await optionRegistry.methods.issue(NewToken._address, USDMock._address, future.unix(), call, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      erc20CallOption = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens an ERC20 call option', async () => {
      await NewToken.methods.approve(optionRegistry._address, toEth(toEth('2'))).send({from: accounts[0]});
      const issue = await optionRegistry.methods.open(erc20CallOption._address, toEth('2')).send({from: accounts[0]})
      const balance = await erc20CallOption.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'));
    })

    it('writer transfers part of erc20 call balance to new account', async () => {
      await erc20CallOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0], gas})
      const balance = await erc20CallOption.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('new account exercises erc20 call option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const usdBalance = await USDMock.methods.balanceOf(accounts[1]).call();
      const oldBalanceToken = await NewToken.methods.balanceOf(accounts[1]).call();
      const series = await optionRegistry.methods.seriesInfo(erc20CallOption._address).call();
      const { expiration, strike } = series;
      const balance = await erc20CallOption.methods.balanceOf(accounts[1]).call();
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await USDMock.methods.approve(optionRegistry._address, toEth(exerciseAmount.toString())).send({from: accounts[1]});
      await optionRegistry.methods.exercise(erc20CallOption._address, toEth('1')).send({from: accounts[1]});
      const newBalance = await erc20CallOption.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceToken = await NewToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual((fromWei(usdBalance) - Number(exerciseAmount)), fromWei(newBalanceUSD), "Strike asset balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceToken), 1, "New Balance of underlying incorrectly updated");
    })

    it('writer closes not transfered balance on ERC20 call option', async () => {
      const closed = await optionRegistry.methods.close(erc20CallOption._address, toEth('1')).send({from: accounts[0]})
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
      const redeem = await optionRegistry.methods.redeem(erc20CallOption._address).send({from: accounts[0]});
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      const { underlyingAmount, strikeAmount } = redeem.events.SeriesRedeemed.returnValues;
      assert.strictEqual(underlyingAmount, '0');
      assert.strictEqual(fromWei(strikeAmount), 300);
      assert.strictEqual(fromWei(newBalanceUSD), 600);
    })

    it('creates a put option token series', async () => {
      let expiration = currentTime.add(24, 'M');
      putOptionExpiration = expiration;
      const issue = await optionRegistry.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, expiration.unix(), put, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      putOption = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens put option token position with ETH', async () => {
      const balanceUSD = await USDMock.methods.balanceOf(accounts[0]).call();
      // amount is amount X strike;
      const amount = 2 * 300;
      await USDMock.methods.approve(optionRegistry._address, toEth(amount)).send({from: accounts[0]});
      const opened = await optionRegistry.methods.open(putOption._address, toEth('2')).send({from: accounts[0]})
      const balance = await putOption.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'))
    })

    it('writer transfers part of put balance to new account', async () => {
      await putOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0], gas})
      const balance = await putOption.methods.balanceOf(accounts[1]).call()
      assert.strictEqual(balance, toEth('1'))
    })

    it('new account exercises put option', async () => {
      await USDMock.methods.mint(accounts[1], toEth('1000')).send({from: accounts[1]});
      const originalBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const series = await optionRegistry.methods.seriesInfo(putOption._address).call();
      const { expiration, strike } = series;
      const balance = await putOption.methods.balanceOf(accounts[1]).call();
      const ethBalance = await getBalance(accounts[1]);
      const exerciseAmount = fromWei(balance) * fromWei(strike);
      await optionRegistry.methods.exercise(putOption._address, balance).send({from: accounts[1], value: toEth('1')});
      const newBalance = await putOption.methods.balanceOf(accounts[1]).call();
      const newBalanceUSD = await USDMock.methods.balanceOf(accounts[1]).call();
      const newBalanceEth = await getBalance(accounts[1]);
      const expectedUSDBalance = fromWei(originalBalanceUSD) + exerciseAmount
      assert.strictEqual(newBalance, '0', "Option token balance incorrectly updated");
      assert.strictEqual(fromWei(newBalanceUSD), expectedUSDBalance, "USD balance incorrectly updated");
      assert.strictEqual(Math.trunc(fromWei(ethBalance) - Math.trunc(fromWei(newBalanceEth))), 1);
    })

    it('writer closes not transfered balance on put option token', async () => {
      const closed = await optionRegistry.methods.close(putOption._address, toEth('1')).send({from: accounts[0]})
      const balance = await putOption.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })

    it('creates an ERC20 put option token series', async () => {
      const now = currentTime;
      const future = moment(now).add(14, 'M');
      erc20PutOptionExpiration = future;
      const issue = await optionRegistry.methods.issue(NewToken._address, USDMock._address, future.unix(), put, strike).send({from: accounts[0]})
      const { events: { OptionTokenCreated } } = issue
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated')
      erc20PutOption = createERC20Instance(OptionTokenCreated.returnValues.token)
    })

    it('opens an ERC20 put option', async () => {
      // amount * strike
      const escrow = 2 * 300;
      const escrowWei = toEth(escrow.toString())
      await USDMock.methods.mint(accounts[0], toEth('1000')).send({from: accounts[0]});
      const balanceToken = await USDMock.methods.balanceOf(accounts[0]).call();
      await USDMock.methods.approve(optionRegistry._address, escrowWei).send({from: accounts[0]});
      const opened = await optionRegistry.methods.open(erc20PutOption._address, toEth('2')).send({from: accounts[0]})
      const balance = await erc20PutOption.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, toEth('2'))
    })

    it('writer transfers part of erc20 put balance to new account', async () => {
      await erc20PutOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0], gas});
      const balance = await erc20PutOption.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(balance, toEth('1'));
    })

    it('new account exercises erc20 put option', async () => {
      const balance = await erc20PutOption.methods.balanceOf(accounts[1]).call();
      const strikeBalance = await USDMock.methods.balanceOf(accounts[1]).call();
      const underlyingBalance = await NewToken.methods.balanceOf(accounts[1]).call();
      const series = await optionRegistry.methods.seriesInfo(erc20PutOption._address).call();
      const { strike } = series;
      await NewToken.methods.approve(optionRegistry._address, balance).send({from: accounts[1]});
      await optionRegistry.methods.exercise(erc20PutOption._address, balance).send({from: accounts[1]});
      const newUnderlyingBalance = await NewToken.methods.balanceOf(accounts[1]).call();
    })

    it('writer closes not transfered balance on erc20 put option', async () => {
      const closed = await optionRegistry.methods.close(erc20PutOption._address, toEth('1')).send({from: accounts[0]})
      const balance = await erc20PutOption.methods.balanceOf(accounts[0]).call()
      assert.strictEqual(balance, '0')
    })
  })

  describe("Exchange", async () => {
    let optionToken;
    let optionTokenExpiration;

    it('Creates an eth call option and deposits it on the exchange', async () => {
      optionTokenExpiration = moment(currentTime).add('12', 'M');
      const issue = await optionRegistry.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, optionTokenExpiration.unix(), call, strike).send({from: accounts[0], gas});
      const { events: { OptionTokenCreated } } = issue;
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated');
      optionToken = createERC20Instance(OptionTokenCreated.returnValues.token);
      const opened = await optionRegistry.methods.open(optionToken._address, toEth('2')).send({from: accounts[0], value: toEth('2'), gas});
      const balance = await optionToken.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'));
      await optionToken.methods.approve(exchange._address, balance).send({from: accounts[0], gas});
      // Exchange
      const deposit = await exchange.methods.depositToken(optionToken._address, balance).send({from: accounts[0], gas});
      const { returnValues: { balance: bal }, event } = deposit.events.Deposit;
      assert.strictEqual(bal, balance);
      assert.strictEqual(event, 'Deposit');
    });

    it('Creates a limit order to the sell the eth call', async () => {
      const order = await exchange.methods.createOrder(
        USDMock._address,
        toEth('50'),
        optionToken._address,
        toEth('2'),
        optionTokenExpiration.unix(),
        '1'
      ).send({from: accounts[0], gas});
      const { event } = order.events.Order
      assert.strictEqual(event, 'Order')
    })

    it('Buys the options from a holder of strike token', async () => {
      const usdBalance = await USDMock.methods.balanceOf(accounts[1]).call();
      await USDMock.methods.approve(exchange._address, toEth('26')).send({from: accounts[1], gas});
      const deposit = await exchange.methods.depositToken(USDMock._address, toEth('26')).send({from: accounts[1], gas});
      const trade = await exchange.methods.trade(
        USDMock._address,
        toEth('50'),
        optionToken._address,
        toEth('2'),
        optionTokenExpiration.unix(),
        '1',
        accounts[0],
        toEth('25')
      ).send({from: accounts[1], gas});
      const optionBalance = await exchange.methods.balanceOf(optionToken._address, accounts[1]).call();
      const { events: Trade } = trade;
      assert.strictEqual(optionBalance, toEth('1'));
      assert.strictEqual(Trade.Trade.event, 'Trade');
    })

    it('Buyer of option should be able to withdraw from exchange', async () => {
      const balanceStart = await optionToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(balanceStart, '0');
      const withdraw = await exchange.methods.withdrawToken(
        optionToken._address,
        toEth('1')
      ).send({from: accounts[1]});
      const balance = await optionToken.methods.balanceOf(accounts[1]).call();
      assert.strictEqual(balance, toEth('1'));
    })
  })

  describe("Liquidity Pools", async () => {
    let liquidityPool;
    let ethLiquidityPool;
    it('Creates a liquidity pool with ERC20 as strikeAsset', async () => {
      const lp = await liquidityPools.methods.createLiquidityPool(
        USDMock._address,
        ZERO_ADDRESS,
        '3',
        '80'
      ).send({from: accounts[0]});
      const { events: { LiquidityPoolCreated: { event, returnValues } } } = lp;
      assert.strictEqual(event, 'LiquidityPoolCreated');
      assert.strictEqual(returnValues.strikeAsset, USDMock._address);
      liquidityPool = createLiquidityPoolInstance(returnValues.lp);
    })

    it('Adds liquidity to the liquidityPool', async () => {
      const balance = await USDMock.methods.balanceOf(accounts[0]).call();
      await USDMock.methods.approve(liquidityPool._address, toEth('1')).send({from: accounts[0], gas});
      const addLiquidity = await liquidityPool.methods.addLiquidity(toEth('1')).send({from: accounts[0], gas});
      const liquidityPoolBalance = await liquidityPool.methods.balanceOf(accounts[0]).call();
      const { events: { LiquidityAdded: { event } } } = addLiquidity;
      assert.strictEqual(liquidityPoolBalance, toEth('1'));
      assert.strictEqual(event, 'LiquidityAdded');
    })

    it('Creates a liquidity pool with ETH as strikeAsset', async () => {
      const lp = await liquidityPools.methods.createLiquidityPool(
        ZERO_ADDRESS,
        USDMock._address,
        '3',
        IMPLIED_VOL
      ).send({from: accounts[0]});
      const { events:
              {
                LiquidityPoolCreated: { event, returnValues }
              }
            } = lp;
      assert.strictEqual(event, 'LiquidityPoolCreated');
      assert.strictEqual(returnValues.strikeAsset, ZERO_ADDRESS);
      ethLiquidityPool = createLiquidityPoolInstance(returnValues.lp);
    })

    it('Adds liquidity to the ETH liquidityPool', async () => {
      const amount = toEth('10');
      const addLiquidity = await ethLiquidityPool.methods.addLiquidity(amount).send({from: accounts[0], gas, value: amount});
      const liquidityPoolBalance = await ethLiquidityPool.methods.balanceOf(accounts[0]).call();
      const { events: { LiquidityAdded: { event } } } = addLiquidity;
      assert.strictEqual(liquidityPoolBalance, amount);
      assert.strictEqual(event, 'LiquidityAdded');
    })

    it('Adds additional liquidity from new account', async () => {
      const balance = await USDMock.methods.balanceOf(accounts[1]).call();
      const sendAmount = toEth('9');
      await USDMock.methods.approve(liquidityPool._address, sendAmount).send({from: accounts[1], gas});
      const totalSupply = await liquidityPool.methods.totalSupply().call();
      const addLiquidity = await liquidityPool.methods.addLiquidity(sendAmount).send({from: accounts[1], gas});
      const liquidityPoolBalance = await liquidityPool.methods.balanceOf(accounts[1]).call();
      const newTotalSupply = await liquidityPool.methods.totalSupply().call();

      // floating point amounts can be off by 1 wei.
      // For a user this should still be acceptable and the rounding error can be accounted for
      const difference = fromWei(liquidityPoolBalance) / fromWei(sendAmount);
      const supplyDifference = fromWei(newTotalSupply) / (fromWei(sendAmount) + fromWei(totalSupply));
      assert.strictEqual(difference, 1);
      assert.strictEqual(supplyDifference, 1);
    })

    it('From eth price quote to USD will match uniswap ', async () => {
      const quote = await priceFeed.methods.getPriceQuote(
        ETH_ADDRESS,
        USDMock._address,
        toEth('1')
      ).call({from: accounts[0]});
      const uniswapQuote = await ethUsdUniswap.methods.getEthToTokenInputPrice(
        toEth('1')
      ).call({from: accounts[0]});
      assert.strictEqual(quote, uniswapQuote, "price feed is incorrect quoted")
    })

    it('Returns a quote for a single USD/ETH call option', async () => {
      const chainTime = await Time.methods.getCurrent().call();
      const expiration = moment(Number(chainTime) * 1000).add('5', 'M');
      const timeDiff = expiration.unix() - Number(chainTime);
      const timeToExpiration = genOptionTimeFromUnix(Number(chainTime), expiration.unix());
      // Amount of ETH to buy 300 USD
      const uniswapQuote = await ethUsdUniswap.methods.getTokenToEthInputPrice(
        toEth('100')
      ).call();
      const ethUniswapQuote = await ethUsdUniswap.methods.getEthToTokenInputPrice(
        toEth('1')
      ).call();
      const uniswapQuoteNormal = fromWei(ethUniswapQuote);
      const strikePrice = uniswapQuoteNormal + 20;
      const quote = await ethLiquidityPool.methods.quotePrice(
        [expiration.unix(), call, toWei(strikePrice.toString()), USDMock._address, ETH_ADDRESS]
      ).call({from: accounts[0]});
      const volatility = Number(IMPLIED_VOL) / 100;
      const localBS = bs.blackScholes(uniswapQuoteNormal, strikePrice, timeToExpiration, volatility, .03, "call");
      const percentDiff = (localBS - fromWei(quote)) / localBS;
      assert.strictEqual(localBS.toFixed(2), fromWei(quote).toFixed(2), "Black Scholes estimates are significantly different");
      assert.strictEqual(percentDiff > 0.01, false, "Black Scholes difference is too high");
    })

    it('Returns a quote for a USD/ETH call with utilization', async () => {

      const totalLiquidity = await ethLiquidityPool.methods.totalSupply().call();
      const balance = await ethLiquidityPool.methods.balanceOf(accounts[0]).call();
      const amount = toEth('5');
      const chainTime = await Time.methods.getCurrent().call();
      const expiration = moment(Number(chainTime) * 1000).add('5', 'M');
      const timeDiff = expiration.unix() - Number(chainTime);
      const timeToExpiration = genOptionTimeFromUnix(Number(chainTime), expiration.unix());
      // Amount of ETH to buy 300 USD
      const uniswapQuote = await ethUsdUniswap.methods.getTokenToEthInputPrice(
        toEth('100')
      ).call();
      const ethUniswapQuote = await ethUsdUniswap.methods.getEthToTokenInputPrice(
        toEth('1')
      ).call();
      const uniswapQuoteNormal = fromWei(ethUniswapQuote);
      const strikePrice = uniswapQuoteNormal + 20;
      const quote = await ethLiquidityPool.methods.quotePriceWithUtilization(
        [expiration.unix(), call, toWei(strikePrice.toString()), USDMock._address, ETH_ADDRESS],
        amount
      ).call({from: accounts[0]});
      const volatility = Number(IMPLIED_VOL) / 100;
      const utilization = fromWei(amount) / fromWei(totalLiquidity);
      const utilizationPrice = uniswapQuoteNormal * utilization;
      const localBS = bs.blackScholes(uniswapQuoteNormal, strikePrice, timeToExpiration, volatility, .03, "call");
      const finalQuote = utilizationPrice > localBS ? utilizationPrice : localBS;
      const percentDiff = (finalQuote - fromWei(quote)) / finalQuote;
      assert.strictEqual(finalQuote.toFixed(2), fromWei(quote).toFixed(2), "Black Scholes estimates are significantly different");
      assert.strictEqual(percentDiff > 0.01, false, "Black Scholes difference is too high");
    })

    let putQuote;
    let putStrikePrice;
    it('Returns a quote for a USD/ETH put with utilization', async () => {

      const totalLiquidity = await ethLiquidityPool.methods.totalSupply().call();
      const balance = await ethLiquidityPool.methods.balanceOf(accounts[0]).call();
      const chainTime = await Time.methods.getCurrent().call();
      const amount = toEth('5');
      const expiration = moment(Number(chainTime) * 1000).add('5', 'M');
      const timeDiff = expiration.unix() - Number(chainTime);
      const timeToExpiration = genOptionTimeFromUnix(Number(chainTime), expiration.unix());
      // Amount of ETH to put 300 USD
      const uniswapQuote = await ethUsdUniswap.methods.getTokenToEthInputPrice(
        toEth('100')
      ).call();
      const ethUniswapQuote = await ethUsdUniswap.methods.getEthToTokenInputPrice(
        toEth('1')
      ).call();
      const uniswapQuoteNormal = fromWei(ethUniswapQuote);
      const strikePrice = uniswapQuoteNormal - 20;
      putStrikePrice = strikePrice;
      const quote = await ethLiquidityPool.methods.quotePriceWithUtilization(
        [expiration.unix(), put, toWei(strikePrice.toString()), USDMock._address, ZERO_ADDRESS],
        amount
      ).call({from: accounts[0]});
      putQuote = quote;
      const volatility = Number(IMPLIED_VOL) / 100;
      const utilization = fromWei(amount) / fromWei(totalLiquidity);
      const utilizationPrice = uniswapQuoteNormal * utilization;
      const localBS = bs.blackScholes(uniswapQuoteNormal, strikePrice, timeToExpiration, volatility, .03, "put");
      const finalQuote = utilizationPrice > localBS ? utilizationPrice : localBS;
      const percentDiff = (finalQuote - fromWei(quote)) / finalQuote;
      assert.strictEqual(finalQuote.toFixed(2), fromWei(quote).toFixed(2), "Black Scholes estimates are significantly different");
      assert.strictEqual(percentDiff > 0.01, false, "Black Scholes difference is too high");
    });

    it('LP Writes a USD/ETH put for premium', async () => {
      const strikeAddress = await ethLiquidityPool.methods.strikeAsset().call();
      // 0.01 ETH
      const amount = toEth('1').slice(0, -2);
      const expiration = await generateExpiration();
      const USDMockAddress = USDMock._address;
      const seriesInfo = [expiration.unix(), put, toWei(putStrikePrice.toString()), USDMockAddress, strikeAddress];
      const quote = await ethLiquidityPool.methods.quotePriceWithUtilization(
        seriesInfo,
        amount
      ).call({from: accounts[0]});
      const premium = fromWei(quote);
      const escrowAmount = fromWei(amount) * putStrikePrice
      const ethBalance = fromWei(await getBalance(ethLiquidityPool._address));
      const expectedBalance = ethBalance + premium - escrowAmount;
      const issue = await optionRegistry.methods.issue(seriesInfo).send({from: accounts[0], gas});
      const issueHash = await optionRegistry.methods.getIssuanceHash(seriesInfo).call();
      const issueAddress = await optionRegistry.methods.getSeriesAddress(issueHash).call();
      const optionToken = createERC20Instance(issueAddress);
      const poolBalance = await optionToken.methods.balanceOf(ethLiquidityPool._address).call();
      const writerBalance = await optionToken.methods.balanceOf(accounts[0]).call();
      const seriesInfoStruct = await optionRegistry.methods.getSeriesInfo(issueAddress).call();
      const write = await ethLiquidityPool.methods.writeOption(
        issueAddress,
        amount
      ).send({from: accounts[0], value: quote, gas});
      const newPoolBalance = await optionToken.methods.balanceOf(ethLiquidityPool._address).call();
      const newWriterBalance = await optionToken.methods.balanceOf(accounts[0]).call();
      const newEthBalance = fromWei(await getBalance(ethLiquidityPool._address));
      assert.strictEqual(expectedBalance.toFixed(2), newEthBalance.toFixed(2), "expected balance does not match actual");
      assert.strictEqual(Number(newWriterBalance) - Number(writerBalance), Number(amount), "writer has been credited with incorrect amount of option token");
    })

  })
  // implement volatility smile
})
