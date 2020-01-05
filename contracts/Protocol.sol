pragma solidity >=0.5.0 <0.7.0;

import "./OptionRegistry.sol";
import "./Exchange.sol";

contract Protocol is
  OptionRegistry,
  Exchange
{

  constructor(address _token, address _usd) public {
    protocolToken = ERC20(_token);
    usdERC20 = ERC20(_usd);
  }

  function() external payable {
    revert();
  }

}
