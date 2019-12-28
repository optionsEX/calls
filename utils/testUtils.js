const ERC20 = require('Embark/contracts/ERC20')

module.exports.toEth = function(str) {
  return str + '000000000000000000'
}

module.exports.createERC20Instance = function(address) {
  return new web3.eth.Contract(ERC20._jsonInterface, address)
}

module.exports.fromWei = function(str) {
  return Number(str) / 10**18
}
