const ERC20 = require('Embark/contracts/ERC20')
const LiquidityPool = require('Embark/contracts/LiquidityPool');
const UniswapExchange = require('Embark/contracts/uniswap_exchange');

module.exports.toEth = function(str) {
  return str + '000000000000000000';
}

module.exports.toWei = function(str) {
  return web3.utils.toWei(str);
}

module.exports.createERC20Instance = function(address) {
  return new web3.eth.Contract(ERC20._jsonInterface, address);
}

module.exports.createLiquidityPoolInstance = function(address) {
  return new web3.eth.Contract(LiquidityPool._jsonInterface, address);
}

module.exports.createUniswapExchangeInstance = function(address) {
  return new web3.eth.Contract(UniswapExchange._jsonInterface, address);
}

module.exports.fromWei = function(str) {
  return Number(str) / 10**18;
}

module.exports.getBalance = function(account) {
  return web3.eth.getBalance(account);
}

const SECONDS_IN_DAY = 86400;
const SECONDS_IN_YEAR = SECONDS_IN_DAY * 365.25;
const genOptionTimeFromUnix = (now, future) => (future - now) / SECONDS_IN_YEAR;
const genOptionTime = (now, future) => genOptionTimeFromUnix(now.unix(), future.unix())
const compareBS = (local, remote) => Math.abs(local - fromWei(remote));
const lessThanCent = (local, remote) => compareBS(local, remote) <= 0.01;

module.exports.genOptionTime = genOptionTime;
module.exports.genOptionTimeFromUnix = genOptionTimeFromUnix;
module.exports.lessThanCent = lessThanCent;



module.exports.increaseTime = async (amount) => {
  return new Promise(function(resolve, reject) {
    const sendMethod = (web3.currentProvider.sendAsync) ? web3.currentProvider.sendAsync.bind(web3.currentProvider) : web3.currentProvider.send.bind(web3.currentProvider);
    sendMethod(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [Number(amount)],
        id: new Date().getSeconds()
      },
      (error) => {
        if (error) {
          console.log(error);
          return reject(error);
        }
        resolve();
      }
    );
  });
};
