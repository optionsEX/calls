pragma solidity >=0.5.0 <0.7.0;

import "../lib/GSN/Context.sol";
import "../ownership/Ownable.sol";
import "./ERC20.sol";

/**
 * @dev Extension of {ERC20} that allows owner to destroy both their own
 * tokens and those that they have an allowance for, in a way that can be
 * recognized off-chain (via event analysis).
 */
contract ERC20Burnable is Context, ERC20, Ownable {
  /**
   * @dev Destroys `amount` tokens from the caller.
   *
   * See {ERC20-_burn}.
   */
  function burn(uint256 amount) public {
    _burn(_msgSender(), amount);
  }

  /**
   * @dev See {ERC20-_burnFrom}.
   */
  function burnFrom(address account, uint256 amount) public onlyOwner {
    _burn(account, amount);
  }
}
