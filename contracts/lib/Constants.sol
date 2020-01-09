pragma solidity >=0.5.0 <0.7.0;


library Constants {
  address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  function ethAddress() public pure returns (address) {
    return ETH;
  }
}
