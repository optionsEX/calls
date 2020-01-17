/*global contract, it*/
const protocol = require('Embark/contracts/Protocol');
const optionRegistry = require('Embark/contracts/OptionRegistry');
const exchange = require('Embark/contracts/Exchange');
const liquidityPools = require('Embark/contracts/LiquidityPools');
const uniswapFactory = require('Embark/contracts/uniswap_factory');
const uniswapExchange = require('Embark/contracts/uniswap_exchange');
const priceFeed = require('Embark/contracts/PriceFeed');
const Time = require('Embark/contracts/Time');
const ERC20 = require('Embark/contracts/ERC20');
const USDMock = require('Embark/contracts/USDMock');
const NewToken = require('Embark/contracts/NewToken');
const moment = require('moment');
const bs = require('black-scholes');
const bsFormula = require('bs-formula');
const { toEth, createERC20Instance, createLiquidityPoolInstance, createUniswapExchangeInstance, fromWei, getBalance, increaseTime, genOptionTimeFromUnix, toWei } = require('../utils/testUtils');

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

let accounts;

config({
  deployment: {
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
    "uniswap_factory": {}
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
    });

    it('creates an option token series', async () => {
      const issue = await optionRegistry.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, expiration.unix(), call, strike).send({from: accounts[0]})
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
      await optionToken.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
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
      await erc20CallOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
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
      await putOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]})
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
      await erc20PutOption.methods.transfer(accounts[1], toEth('1')).send({from: accounts[0]});
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
      const issue = await optionRegistry.methods.issue(ZERO_ADDRESS, ZERO_ADDRESS, optionTokenExpiration.unix(), call, strike).send({from: accounts[0]});
      const { events: { OptionTokenCreated } } = issue;
      assert.strictEqual(OptionTokenCreated.event, 'OptionTokenCreated');
      optionToken = createERC20Instance(OptionTokenCreated.returnValues.token);
      const opened = await optionRegistry.methods.open(optionToken._address, toEth('2')).send({from: accounts[0], value: toEth('2')});
      const balance = await optionToken.methods.balanceOf(accounts[0]).call();
      assert.strictEqual(balance, toEth('2'));
      await optionToken.methods.approve(exchange._address, balance).send({from: accounts[0]});
      // Exchange
      const deposit = await exchange.methods.depositToken(optionToken._address, balance).send({from: accounts[0]});
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
      ).send({from: accounts[0]});
      const { event } = order.events.Order
      assert.strictEqual(event, 'Order')
    })

    it('Buys the options from a holder of strike token', async () => {
      const usdBalance = await USDMock.methods.balanceOf(accounts[1]).call();
      await USDMock.methods.approve(exchange._address, toEth('26')).send({from: accounts[1]});
      const deposit = await exchange.methods.depositToken(USDMock._address, toEth('26')).send({from: accounts[1]});
      const trade = await exchange.methods.trade(
        USDMock._address,
        toEth('50'),
        optionToken._address,
        toEth('2'),
        optionTokenExpiration.unix(),
        '1',
        accounts[0],
        toEth('25')
      ).send({from: accounts[1]});
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
      await USDMock.methods.approve(liquidityPool._address, toEth('1')).send({from: accounts[0]});
      const addLiquidity = await liquidityPool.methods.addLiquidity(toEth('1')).send({from: accounts[0], gas: 13289970});
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
      const addLiquidity = await ethLiquidityPool.methods.addLiquidity(toEth('1')).send({from: accounts[0], gas: 13289970, value: toEth('1')});
      const liquidityPoolBalance = await ethLiquidityPool.methods.balanceOf(accounts[0]).call();
      const { events: { LiquidityAdded: { event } } } = addLiquidity;
      assert.strictEqual(liquidityPoolBalance, toEth('1'));
      assert.strictEqual(event, 'LiquidityAdded');
    })

    it('Adds additional liquidity from new account', async () => {
      const balance = await USDMock.methods.balanceOf(accounts[1]).call();
      const sendAmount = toEth('9');
      await USDMock.methods.approve(liquidityPool._address, sendAmount).send({from: accounts[1]});
      const totalSupply = await liquidityPool.methods.totalSupply().call();
      const addLiquidity = await liquidityPool.methods.addLiquidity(sendAmount).send({from: accounts[1]});
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
      const inputs = {
        currentPrice: uniswapQuoteNormal,
        strikePrice,
        interestRate: 0.03,
        volatility,
        timeToExpiration
      };
      const computedBS = bsFormula(inputs);
      const localBS = bs.blackScholes(uniswapQuoteNormal, strikePrice, timeToExpiration, volatility, .03, "call");
      const percentDiff = (localBS - fromWei(quote)) / localBS;
      assert.strictEqual(localBS.toFixed(2), fromWei(quote).toFixed(2), "Black Scholes estimates are significantly different");
      assert.strictEqual(percentDiff > 0.01, false, "Black Scholes difference is too high");

    })
    // get option quote from liquidity pool

  })
})
