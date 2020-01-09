pragma solidity >=0.5.0 <0.7.0;

import "./ERC20Mintable.sol";
import "./ERC20Burnable.sol";
import "./ERC20Detailed.sol";
import "./ERC20.sol";

// we don't store much state here either
contract TokenMock is
  ERC20,
  ERC20Mintable,
  ERC20Burnable,
  ERC20Detailed
{
    constructor() public {
      // this needs to be here to avoid zero initialization of token rights.
      _mint(msg.sender, 100 ether);
    }
}
