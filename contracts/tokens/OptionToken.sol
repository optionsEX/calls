pragma solidity >=0.5.0 <0.7.0;

import "./ERC20Mintable.sol";
import "./ERC20Burnable.sol";
import "./ERC20Detailed.sol";
import "./ERC20.sol";

contract OptionToken is
  ERC20,
  ERC20Mintable,
  ERC20Burnable,
  ERC20Detailed
{
  bytes32 public _issuanceHash;

  /**
   * @dev Sets the values for `name`, `symbol`, and `issuanceHash`. All three of
   * these values are immutable: they can only be set once during
   * construction.
   */
  constructor (bytes32 issuanceHash) public {
    // _name = name;
    // _symbol = symbol;
    _issuanceHash = issuanceHash;
  }
}
