const ERC20 = require('Embark/contracts/ERC20')

module.exports.toEth = function(str) {
  return str + '000000000000000000';
}

module.exports.createERC20Instance = function(address) {
  return new web3.eth.Contract(ERC20._jsonInterface, address);
}

module.exports.fromWei = function(str) {
  return Number(str) / 10**18;
}

module.exports.getBalance = function(account) {
  return web3.eth.getBalance(account);
}

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
        console.log('Finsihed the first', error);
        if (error) {
          console.log(error);
          return reject(error);
        }
        resolve();
      }
    );
  });
};
