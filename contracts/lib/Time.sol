pragma solidity >=0.5.0 <0.7.0;

contract Time {
  function getCurrent() public returns(uint) {
    return now;
  }
}
